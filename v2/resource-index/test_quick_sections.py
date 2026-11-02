import collections
import types
import unittest
import numpy as np
from quick_sections import QuickSections


class SoftwareViewTests(unittest.TestCase):
    def test_scope_preserves_vector_owners_without_changing_fulltext(self):
        base = types.SimpleNamespace(
            directory=self.__class__.__name__,
            dbfile="synthetic.db",
            embed=None,
            files={
                "device": {"kind": "manual", "attributes": {}},
                "app": {"kind": "manual", "attributes": {"subjectType": "software", "software": ["DemoApp"]}},
                "other": {
                    "kind": "manual",
                    "attributes": {"subjectType": "software", "software": ["OtherApp"]},
                },
            },
            rows=[{"file_id": "device"}, {"file_id": "app"}, {"file_id": "other"}, {"file_id": "app"}],
            counts=[
                collections.Counter(x=1),
                collections.Counter(y=2),
                collections.Counter(z=1),
                collections.Counter(y=1),
            ],
            lengths=[1, 2, 1, 1],
            owners=np.array([0, 1, 1, 2, 3]),
            vectors=np.array([[0], [10], [11], [20], [30]]),
            known=["device"],
        )
        quick = QuickSections(base)
        view = quick.view(["DemoApp"])
        self.assertEqual(list(view.files), ["app"])
        self.assertEqual(view.owners.tolist(), [0, 0, 1])
        self.assertEqual(view.vectors.tolist(), [[10], [11], [30]])
        self.assertEqual(view.df["y"], 2)
        self.assertEqual(len(base.rows), 4)
        self.assertEqual(base.owners.tolist(), [0, 1, 1, 2, 3])
        self.assertIs(quick.view(["demoapp"]), view)
        self.assertFalse(quick.view(["Unregistered"]).files)
        for index in range(12):
            quick.view(["Missing" + str(index)])
        self.assertLessEqual(len(quick.views), 8)
        self.assertEqual(len(base.rows), 4)

    def test_scope_rejects_non_list_and_non_string_values(self):
        quick = QuickSections(None)
        for value in ["DemoApp", [None], [], list("123456789")]:
            with self.assertRaises(ValueError):
                quick.view(value)


if __name__ == "__main__":
    unittest.main()
