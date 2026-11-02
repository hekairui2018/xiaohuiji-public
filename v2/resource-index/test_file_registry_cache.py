import concurrent.futures
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from file_registry import FileRegistry
from file_registry_cache import FileRegistryCache


@contextmanager
def database(path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


class RegistryCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.sections = self.work / "sections"
        self.sections.mkdir()
        self.config = self.work / "section-search.json"
        self.config.write_text(json.dumps({"index": str(self.sections)}), encoding="utf-8")
        with database(self.sections / "sections.db") as db:
            db.execute(
                "CREATE TABLE files(id TEXT,name TEXT,kind TEXT,path TEXT,size INTEGER,mtime_ns INTEGER,sha256 TEXT,models TEXT,attributes TEXT,download TEXT)"
            )
        with database(self.work / "resources.db") as db:
            db.executescript(
                "CREATE TABLE locations(id INTEGER,name TEXT,path TEXT,bytes INTEGER,mtime_ns INTEGER,sha256 TEXT,state TEXT); CREATE TABLE approved_files(sha256 TEXT,type TEXT);"
            )
        self.loads = 0

        def factory(directory, work):
            self.loads += 1
            return FileRegistry(directory, work)

        self.cache = FileRegistryCache(self.config, self.work, factory)

    def add_original(self, number):
        file = self.work / ("HDPlayer说明书" + str(number) + ".pdf")
        file.write_bytes(("synthetic source " + str(number)).encode())
        stat = file.stat()
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        with database(self.work / "resources.db") as db:
            db.execute(
                "INSERT INTO locations VALUES(?,?,?,?,?,?,?)",
                (number, file.name, str(file), stat.st_size, stat.st_mtime_ns, sha, "present"),
            )
            db.execute("INSERT INTO approved_files VALUES(?,?)", (sha, "document"))
        return file, sha

    def test_reuses_snapshot_and_refreshes_new_and_revoked_approvals(self):
        _, sha = self.add_original(1)
        first = self.cache.get()
        self.assertIs(self.cache.get(), first)
        self.assertEqual(self.loads, 1)
        self.add_original(2)
        second = self.cache.get()
        self.assertEqual(len(second.search("HDPlayer说明书")["results"]), 2)
        self.assertIsNot(first, second)
        with database(self.work / "resources.db") as db:
            db.execute("DELETE FROM approved_files WHERE sha256=?", (sha,))
        self.assertEqual(len(self.cache.get().search("HDPlayer说明书")["results"]), 1)

    def test_cached_registry_still_checks_original_file_availability(self):
        file, _ = self.add_original(1)
        registry = self.cache.get()
        file.unlink()
        self.assertIs(self.cache.get(), registry)
        self.assertEqual(registry.search("HDPlayer说明书")["results"], [])

    def test_parallel_cold_requests_build_one_snapshot(self):
        self.add_original(1)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            values = list(pool.map(lambda _: self.cache.get(), range(12)))
        self.assertTrue(all(value is values[0] for value in values))
        self.assertEqual(self.loads, 1)

    def test_metadata_changes_invalidate_and_failed_refresh_never_serves_old_data(self):
        self.add_original(1)
        first = self.cache.get()
        metadata = self.work / "quick-catalog-metadata.json"
        metadata.write_text('{"resources":[]}', encoding="utf-8")
        self.assertIsNot(self.cache.get(), first)
        metadata.write_text("{broken", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            self.cache.get()

    def test_wal_approval_changes_refresh_before_checkpoint(self):
        _, sha = self.add_original(1)
        writer = sqlite3.connect(self.work / "resources.db")
        try:
            writer.execute("PRAGMA journal_mode=WAL")
            first = self.cache.get()
            writer.execute("DELETE FROM approved_files WHERE sha256=?", (sha,))
            writer.commit()
            second = self.cache.get()
            self.assertIsNot(first, second)
            self.assertEqual(second.search("HDPlayer说明书")["results"], [])
        finally:
            writer.close()


if __name__ == "__main__":
    unittest.main()
