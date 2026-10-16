import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import session


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = patch.object(session, 'WORK', Path(self.temp.name))
        self.work.start()
        session.prepare('synthetic', '局部闪烁', 'holdout')

    def tearDown(self):
        self.work.stop()
        self.temp.cleanup()

    def baseline(self):
        session.write_once(session.case_path('synthetic') / 'model-000.json', {
            'usable': True, 'response': {'choices': [{'message': {
                'role': 'assistant', 'content': '需要确认发生时间'}}]}})

    def test_blind_baseline_ignores_engineer_and_comparison(self):
        folder = session.case_path('synthetic')
        session.write_once(folder / 'engineer.json', {'text': 'SECRET_ENGINEER'})
        session.write_once(folder / 'comparison.json', {'text': 'SECRET_REVIEW'})
        messages = str(session.messages_for(folder, 0))
        self.assertNotIn('SECRET_', messages)
        self.assertIn('局部闪烁', messages)

    def test_engineer_requires_usable_baseline(self):
        with self.assertRaises(FileNotFoundError):
            session.record('synthetic', 'engineer', '判断')
        self.baseline()
        session.record('synthetic', 'engineer', '判断')
        with self.assertRaises(FileExistsError):
            session.record('synthetic', 'engineer', '改写判断')

    def test_feedback_preserves_history_and_split(self):
        self.baseline()
        session.record('synthetic', 'feedback', '交换后故障没有跟随', 1)
        messages = session.messages_for(session.case_path('synthetic'), 1)
        self.assertEqual(messages[2]['role'], 'assistant')
        self.assertIn('没有跟随', messages[3]['content'])
        self.assertEqual(session.read(session.case_path('synthetic') / 'case.json')['split'], 'holdout')

    def test_failed_turn_blocks_continuation(self):
        session.write_once(session.case_path('synthetic') / 'model-000.json', {'usable': False})
        with self.assertRaises(ValueError):
            session.messages_for(session.case_path('synthetic'), 1)

    def test_path_traversal_and_case_overwrite_blocked(self):
        with self.assertRaises(ValueError):
            session.case_path('../escape')
        with self.assertRaises(FileExistsError):
            session.prepare('synthetic', 'different', 'train-candidate')


if __name__ == '__main__':
    unittest.main()
