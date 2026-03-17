from __future__ import annotations

import unittest

from pipeline.normalize import JS_SAFE_INTEGER_MAX, _stable_int_id


class SafeJobIdTests(unittest.TestCase):
    def test_numeric_ids_within_safe_range_are_preserved(self) -> None:
        self.assertEqual(_stable_int_id(123456), 123456)
        self.assertEqual(_stable_int_id(str(JS_SAFE_INTEGER_MAX)), JS_SAFE_INTEGER_MAX)

    def test_numeric_ids_above_safe_range_are_hashed_down(self) -> None:
        unsafe = "757275500542986932"
        stable = _stable_int_id(unsafe)
        self.assertLessEqual(stable, JS_SAFE_INTEGER_MAX)
        self.assertEqual(stable, _stable_int_id(unsafe))
        self.assertNotEqual(stable, int(unsafe))

    def test_string_source_ids_hash_to_safe_range(self) -> None:
        stable = _stable_int_id("lever:spotify:cf2ab23e-8bb8-455c-9a49-a43cca51fb97")
        self.assertLessEqual(stable, JS_SAFE_INTEGER_MAX)
        self.assertEqual(stable, _stable_int_id("lever:spotify:cf2ab23e-8bb8-455c-9a49-a43cca51fb97"))


if __name__ == "__main__":
    unittest.main()
