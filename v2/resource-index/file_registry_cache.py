"""One replaceable registry snapshot, invalidated by its authoritative inputs."""

import json
from pathlib import Path
import threading

from file_registry import FileRegistry


def stamp(path):
    try:
        value = path.stat()
        return (str(path), value.st_size, value.st_mtime_ns)
    except FileNotFoundError:
        return (str(path), None, None)


class FileRegistryCache:
    def __init__(self, section_config, work, factory=FileRegistry):
        self.section_config = Path(section_config)
        self.work = Path(work)
        self.factory = factory
        self.lock = threading.Lock()
        self.config_stamp = None
        self.signature = None
        self.directory = None
        self.registry = None
        self.generation = 0

    def get(self):
        with self.lock:
            config_stamp = stamp(self.section_config)
            if config_stamp != self.config_stamp:
                config = json.loads(self.section_config.read_text(encoding="utf-8"))
                self.directory = Path(config["index"])
                self.config_stamp = config_stamp
            paths = [
                self.directory / "sections.db",
                self.directory / "sections.db-wal",
                self.work / "resources.db",
                self.work / "resources.db-wal",
                self.work / "quick-catalog-metadata.json",
                self.work / "approved-identities.json",
            ]
            signature = (config_stamp, *(stamp(path) for path in paths))
            if signature != self.signature:
                # A failed rebuild must fail the request, never serve stale
                # permissions or an old snapshot as an implicit fallback.
                registry = self.factory(self.directory, self.work)
                self.registry = registry
                self.signature = signature
                self.generation += 1
            return self.registry
