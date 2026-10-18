"""Current-edition filter over existing catalogue metadata, never source scanning.

Keep model suffixes, languages, hardware/chip qualifiers and reviewed scope in
the family identity. Firmware and unversioned documents are not superseded here.
"""
import json
import re
from pathlib import Path
from threading import Lock

_cache = {}
_lock = Lock()


def historical_locations(rows):
    candidates = []
    newest = {}
    for row in rows:
        if row.get('availabilityState') != 'present':
            continue
        name = row.get('name', '')
        meta = row.get('documentMetadata') or {}
        if Path(name).suffix.lower() not in ('.pdf', '.docx', '.doc', '.txt', '.md', '.ppt', '.pptx', '.xls', '.xlsx'):
            continue
        stem = re.sub(r'[-_ ]*已修改$', '', re.sub(r'\.[a-z0-9]+$', '', name, flags=re.I))
        found = list(re.finditer(r'V\s*(\d+(?:\.\d+)+)(?![A-Za-z0-9.])', stem, re.I))
        if len(found) != 1:
            continue
        match = found[0]
        version = 'V' + match[1]
        if meta.get('version') and str(meta['version']).upper() != version.upper():
            continue
        family = stem[:match.start()] + '{version}' + stem[match.end():]
        if meta.get('familyId') and meta.get('classificationStatus') == 'manual-review':
            family = 'reviewed-family:' + meta['familyId']
        family = re.sub(r'(?<![A-Za-z0-9])20\d{2}[-_.]?[01]\d[-_.]?[0-3]\d(?!\d)', '', family)
        family = re.sub(r'^HD[-_ ]?', '', family, flags=re.I)
        family = re.sub(r'\bspecifications\b', 'Specification', family, flags=re.I)
        family = re.sub(r'\s*&\s*', ' ', family).replace('_', ' ')
        family = re.sub(r'\s+', ' ', family).strip().upper()
        name_conditions = re.findall(r'(?<![A-Za-z0-9])(?:E\d+|HW[-_ ]?[A-Za-z0-9.]+|REV[-_ ]?[A-Za-z0-9.]+|Android\s*\d+(?:\.\d+)?|安卓\d+(?:\.\d+)?|BOX|TP)(?![A-Za-z0-9])', stem, re.I)
        scope = json.dumps([meta.get('coverModels', []), meta.get('scopeEvidence', []), [x.upper() for x in name_conditions], row.get('hardwareVersion'), row.get('applicability'), bool(re.search(r'签章|盖章|签字|(?<![A-Za-z])signed(?![A-Za-z])',name,re.I))], ensure_ascii=False, sort_keys=True)
        language = 'zh' if re.search(r'[\u4e00-\u9fff]', stem) else 'en'
        key = (family, language, scope)
        numbers = tuple(int(n) for n in match[1].split('.'))
        # 1.1 and 1.1.0 are the same numeric edition.
        while len(numbers) > 1 and numbers[-1] == 0:
            numbers = numbers[:-1]
        newest[key] = max(newest.get(key, numbers), numbers)
        candidates.append((row['locationId'], key, numbers))
    return frozenset(location for location, key, numbers in candidates if numbers < newest[key])


def excluded_locations(db, work):
    from catalog_metadata import catalog
    rows = catalog(db, work)  # Existing metadata cache; no OCR or source traversal.
    key = str(Path(work).resolve())
    with _lock:
        previous = _cache.get(key)
        if previous is not None and previous[0] is rows:
            return previous[1]
        result = historical_locations(rows)
        if len(_cache) >= 8:
            _cache.clear()
        _cache[key] = (rows, result)
        return result
