"""Opt-in evidence-unit prototype over existing blocks; no parser or second index.

Profiles are trusted, locally reviewed source spans, NOT client input. They are
intentionally small: lost PDF layout/Excel merged headers must not be invented.
No HTTP route enables this prototype. The existing expert handle layer remains
responsible for session-scoped search -> read authorization in a future rollout.
"""
import hashlib
import json

import engine
import proximity

REVISION = 'knowledge-unit-prototype-1'
KINDS = {'parameter-row', 'task', 'firmware-entry', 'case', 'faq',
         'business-record', 'technical-topic', 'interface', 'section'}


def source_span(block, start=0, end=None, role='body'):
    """Record a reviewed span without copying source text into a profile."""
    return {'blockId': block['id'], 'start': start,
            'end': len(block['text']) if end is None else end, 'role': role,
            'textHash': hashlib.sha256(block['text'].encode('utf8')).hexdigest()}


class UnitReader:
    def __init__(self, profiles, authorized_hashes):
        # Profiles never grant permission. Intersect them with the caller's scope
        # before FTS limits, and recheck permission when restoring every unit.
        self.profiles = profiles
        self.allowed = set(profiles).intersection(authorized_hashes)

    def context(self, db, block_id, anchor=0):
        b = db.execute('SELECT * FROM blocks WHERE id=?', (block_id,)).fetchone()
        if not b or b['hash'] not in self.allowed:
            raise PermissionError('unit-outside-authorized-scope')
        matches = []
        for definition in self.profiles[b['hash']]:
            if any(s['role'] == 'body' and s['blockId'] == block_id and
                   s['start'] <= anchor < s['end'] for s in definition['spans']):
                matches.append(definition)
        if len(matches) > 1:
            raise ValueError('ambiguous-reviewed-unit')
        if not matches:
            # No verified boundary: return the actual fragment, never its random
            # neighbors and never claim that a task/table/case is complete.
            # A fragment must not swallow a separately reviewed row/topic from
            # the same PDF block when another keyword occurs outside that unit.
            edges = sorted({0, len(b['text']), *(
                edge for d in self.profiles[b['hash']] for s in d['spans']
                if s['blockId'] == block_id for edge in (s['start'], s['end']))})
            low = max(e for e in edges if e <= anchor)
            high = min((e for e in edges if e > anchor), default=len(b['text']))
            definition = {'kind': 'section', 'uses': [], 'complete': False,
                          'basis': 'parsed-fragment-boundary-unverified',
                          'spans': [source_span(b, low, high)]}
        else:
            definition = matches[0]
        if definition['kind'] not in KINDS or not definition.get('basis'):
            raise ValueError('invalid-unit-definition')
        parts = []
        body_rows = set()
        sheets = set()
        for span in definition['spans']:
            r = db.execute('SELECT * FROM blocks WHERE id=?', (span['blockId'],)).fetchone()
            if not r or r['hash'] != b['hash']:
                raise ValueError('cross-original-unit')
            if hashlib.sha256(r['text'].encode('utf8')).hexdigest() != span['textHash']:
                raise ValueError('stale-reviewed-span')
            a, z = span['start'], span['end']
            if span['role'] not in ('body', 'header', 'condition') or not 0 <= a < z <= len(r['text']):
                raise ValueError('invalid-source-span')
            loc = json.loads(r['locator'])
            if 'row' in loc:
                sheets.add((loc.get('part'), loc.get('sheet'), loc.get('table')))
                if span['role'] == 'body':
                    body_rows.add((loc.get('sheet'), loc.get('table'), loc['row']))
            parts.append({'blockId': r['id'], 'ordinal': r['ordinal'], 'locator': loc,
                          'charStart': a, 'charEnd': z, 'text': r['text'][a:z],
                          'role': span['role']})
        if len(body_rows) > 1 or len(sheets) > 1:
            raise ValueError('cross-record-unit')
        body = '\n'.join(p['text'] for p in parts if p['role'] == 'body')
        headings = [m for m in proximity.CASE_START.finditer(body)
                    if m.group().lstrip().startswith('案例')]
        if len(headings) > 1 or len(list(proximity.MODEL_START.finditer(body))) > 1:
            raise ValueError('cross-case-or-model-unit')
        identity = [REVISION, b['hash'], definition['spans']]
        unit_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        text = '\n'.join(p['text'] for p in parts)
        target = 0
        for p in parts:
            if p['blockId'] == block_id and p['role'] == 'body':
                target += anchor - p['charStart']
                break
            target += len(p['text']) + 1
        return {'text': text, 'parts': parts, 'sha256': b['hash'],
                'boundary': 'reviewed-' + definition['kind'] if matches else definition['basis'],
                'targetOffset': target, 'bounded': not definition['complete'],
                'knowledgeUnit': {'id': unit_id, 'revision': REVISION,
                    'documentId': b['hash'], 'parentId': b['hash'],
                    'kind': definition['kind'], 'uses': definition['uses'],
                    'boundaryBasis': definition['basis'],
                    'complete': definition['complete'], 'compatibilityConfirmed': False,
                    'sourceSpans': [{k: v for k, v in p.items() if k != 'text'} for p in parts],
                    'readAuthority': 'caller-scope-required;not-a-public-read-token'}}

    def search(self, work, query, **kwargs):
        return proximity.search(work, query, context_builder=self.context,
                                authorized_keys=self.allowed, **kwargs)

    def read(self, work, block, anchor=0, offset=0):
        return proximity.read(work, block, anchor, offset, context_builder=self.context)


def metadata_unit(item):
    """Registered binary/video metadata is evidence about a file, not its body."""
    return {'documentId': item.get('sha256') or item.get('versionId'),
            'resourceId': item.get('resourceId'), 'versionId': item.get('versionId'),
            'availability': item.get('availabilityState'),
            'kind': 'registered-asset', 'uses': ['resource-location'],
            'name': item.get('name'), 'sourceDirectory': item.get('folders', []),
            'bodyParsed': False, 'complete': False, 'compatibilityConfirmed': False,
            'scopeEvidence': item.get('documentMetadata', {}).get('scopeEvidence', [])}
