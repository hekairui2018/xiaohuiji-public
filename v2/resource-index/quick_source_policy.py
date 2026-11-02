"""Software source scopes shared with quick-mode JavaScript consumers."""

import json
from pathlib import Path

SOFTWARE_SCOPES = json.loads(
    Path(__file__).with_name("quick-software-scopes.json").read_text(encoding="utf-8")
)


def excludes_software_scope(software, text):
    source = text.casefold()
    return any(
        scope.casefold() in source
        for name in software
        for scope in SOFTWARE_SCOPES.get(name, {}).get("excludedScopes", [])
    )
