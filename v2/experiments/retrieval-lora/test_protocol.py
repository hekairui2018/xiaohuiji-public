import json
import unittest
from pathlib import Path
from protocol import parse_raw, score
from build_data import OUT


class DataContract(unittest.TestCase):
    def test_review_gate_and_no_holdout_overlap(self):
        candidates=[json.loads(x) for x in (OUT/'candidates.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertEqual(len(candidates),100)
        sets={}
        for split,count in [('train',48),('validation',16),('test',16)]:
            rows=[json.loads(x) for x in (OUT/f'{split}.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual(len(rows),count)
            self.assertTrue(all(r['status']=='policy_reviewed' for r in rows))
            sets[split]={r['customer'].strip().casefold() for r in rows}
            for row in rows:
                action=parse_raw(json.dumps(row['target']))
                self.assertTrue(score(action,row)['strict'])
        self.assertFalse(sets['train']&sets['test'])
        self.assertFalse(sets['validation']&sets['test'])
        pending=[r for r in candidates if r['status']=='pending_engineer_review']
        self.assertEqual(len(pending),20)
        self.assertTrue(all(r['source']['type']=='case_phenomenon_only' for r in pending))
        self.assertTrue(all('historicalSolution' not in r for r in candidates))

    def test_no_answer_fabrication_and_no_json_repair(self):
        for text in ['{"action":"answer","claims":[]}', '答案是 {"action":"clarify","question":"型号？"}', '{"action":"read","blockId":7}', '{"action":"search","kind":"invented","query":"x","goals":["x"],"concepts":["x"]}']:
            with self.assertRaises(ValueError):parse_raw(text)

    def test_suffix_chip_version_are_exact(self):
        row=dict(target=dict(action='search',kind='firmware',models=['R512S'],chips=['ICN2153'],version='V1.2.3'),keyword_groups=[['固件']])
        action=dict(action='search',kind='firmware',query='R512S固件',goals=['固件'],concepts=['固件'],models=['R512'],chips=['ICN2153'],version='V1.2.3')
        result=score(action,row)
        self.assertFalse(result['models']);self.assertFalse(result['strict'])

    def test_a_bad_kind_does_not_erase_correct_extraction(self):
        row=dict(target=dict(action='search',kind='firmware',models=['R512S'],chips=['ICN2153']),keyword_groups=[['固件']])
        action=dict(action='search',kind='资料类型',query='R512S固件',goals=['固件'],concepts=['固件'],models=['R512S'],chips=['ICN2153'])
        result=score(action,row)
        self.assertTrue(result['models']);self.assertTrue(result['chips']);self.assertFalse(result['kind'])
        with self.assertRaises(ValueError):parse_raw(json.dumps(action))


if __name__=='__main__':unittest.main()
