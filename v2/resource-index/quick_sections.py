"""Quick-only software manual views over the existing approved section index.

Reuse parsed sections, embeddings and the shared retrieval implementation. Never
write an index, infer hardware compatibility, or mutate the fulltext instance.
"""
import collections
import copy
import threading
import re
import numpy as np


class QuickSections:
    def __init__(self, index):
        self.index = index
        self.views = {}
        self.lock = threading.Lock()

    def view(self, software):
        if not isinstance(software, list) or not all(isinstance(s, str) for s in software):
            raise ValueError('Invalid software scope')
        normalize = lambda s: re.sub(r'[\s_-]+', '', s.casefold())
        names = tuple(sorted({normalize(s) for s in software if s.strip()}))
        if not names or len(names) > 8:
            raise ValueError('Invalid software scope')
        with self.lock:
            if names in self.views:
                return self.views[names]
            base = self.index
            files = {key: f for key, f in base.files.items()
                     if f['kind'] == 'manual'
                     and f['attributes'].get('subjectType') == 'software'
                     and any(normalize(str(s)) in names for s in f['attributes'].get('software', []))}
            positions = [i for i, row in enumerate(base.rows) if row['file_id'] in files]
            view = copy.copy(base)
            view.files = files
            view.rows = [base.rows[i] for i in positions]
            view.search_rows = list(view.rows)
            view.doc_count = len(positions)
            view.counts = [base.counts[i] for i in positions]
            view.lengths = [base.lengths[i] for i in positions]
            view.avg = sum(view.lengths) / max(1, len(view.lengths))
            view.df = collections.Counter()
            for count in view.counts:
                view.df.update(count.keys())
            remap = {old: new for new, old in enumerate(positions)}
            mask = np.isin(base.owners, positions)
            view.vectors = base.vectors[mask]
            view.owners = np.asarray([remap[int(i)] for i in base.owners[mask]], dtype=np.int64)
            view.known = []  # Software manuals do not acquire hardware identities.
            view.attribute_units = []
            self.views[names] = view
            return view

    def search(self, query, software):
        result = self.view(software).search(query, limit=12)
        result['scope'] = 'registered-software-manuals'
        result['software'] = software
        return result
