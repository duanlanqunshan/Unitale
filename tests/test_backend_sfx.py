import os
import tempfile
import unittest

import backend_sfx_extension as sfx


class LocalSfxPathTests(unittest.TestCase):
    def test_rejects_absolute_relative_path(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                sfx._resolve_local_sfx_path(root, os.path.abspath(__file__))

    def test_rejects_path_outside_allowed_roots(self):
        with tempfile.TemporaryDirectory() as allowed, tempfile.TemporaryDirectory() as untrusted:
            with self.assertRaises(ValueError):
                sfx._validate_requested_root(untrusted, [allowed])

    def test_accepts_file_inside_allowed_root(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, 'doors')
            os.makedirs(nested)
            expected = os.path.join(nested, 'hit.wav')
            with open(expected, 'wb') as file:
                file.write(b'RIFF')
            actual = sfx._resolve_local_sfx_path(root, 'doors/hit.wav')
            self.assertEqual(actual, os.path.realpath(expected))


if __name__ == '__main__':
    unittest.main()
