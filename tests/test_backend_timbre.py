import os
import io
import re
import tempfile
import unittest

from backend_main import app
from fastapi.testclient import TestClient


class TimbreSaveToDiskTests(unittest.TestCase):
    """音色落盘端点 /v1/timbre/save_to_disk 的命名与同名防覆盖"""

    def setUp(self):
        self.client = TestClient(app)
        self.tmp = tempfile.TemporaryDirectory()
        self.save_dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _post(self, timbre_name, description, is_tts, original_filename=None):
        files = {'file': ('ignored.wav', b'RIFF\x00\x00\x00\x00WAVE', 'audio/wav')}
        data = {
            'timbre_name': timbre_name,
            'description': description,
            'is_tts': 'true' if is_tts else 'false',
            'save_dir': self.save_dir,
        }
        if original_filename:
            data['original_filename'] = original_filename
        return self.client.post('/v1/timbre/save_to_disk', files=files, data=data)

    def test_tts_timbre_uses_name_desc_timestamp(self):
        """TTS 音色落盘文件名应为 {音色名}_{描述}_{时间戳}.wav"""
        res = self._post('张三_AI', '低沉男声', True)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['code'], 200)
        fname = os.path.basename(body['path'])
        # 形如：张三_AI_低沉男声_20260730_014500.wav
        self.assertTrue(re.match(r'^张三_AI_低沉男声_\d{8}_\d{6}\.wav$', fname),
                        f'文件名不符合 TTS 规则: {fname}')

    def test_tts_timbre_without_description(self):
        """TTS 音色描述为空，文件名应省略描述段"""
        res = self._post('旁白_AI', '', True)
        self.assertEqual(res.status_code, 200)
        fname = os.path.basename(res.json()['path'])
        self.assertTrue(re.match(r'^旁白_AI_\d{8}_\d{6}\.wav$', fname),
                        f'描述为空时应省略: {fname}')

    def test_uploaded_timbre_keeps_original_name(self):
        """用户上传音色保留原名"""
        res = self._post('我的录音', '', False, original_filename='我的录音.m4a')
        self.assertEqual(res.status_code, 200)
        fname = os.path.basename(res.json()['path'])
        self.assertEqual(fname, '我的录音.m4a')

    def test_uploaded_same_name_auto_increment(self):
        """同名用户上传音色自动加 (1) (2)"""
        self._post('我的录音', '', False, original_filename='我的录音.m4a')
        res2 = self._post('我的录音', '', False, original_filename='我的录音.m4a')
        self.assertEqual(res2.status_code, 200)
        fname2 = os.path.basename(res2.json()['path'])
        self.assertEqual(fname2, '我的录音(1).m4a')

        res3 = self._post('我的录音', '', False, original_filename='我的录音.m4a')
        fname3 = os.path.basename(res3.json()['path'])
        self.assertEqual(fname3, '我的录音(2).m4a')

    def test_description_special_chars_sanitized(self):
        """描述中含标点空格的应被清理为下划线，非法字符删除"""
        res = self._post('李四_AI', '低沉， 男声·带磁性', True)
        self.assertEqual(res.status_code, 200)
        fname = os.path.basename(res.json()['path'])
        # 不应含 ，空格·等
        self.assertNotRegex(fname, r'[，,· /\\?%*:|"<>\s]')
        self.assertRegex(fname, r'^李四_AI_[\w]+_\d{8}_\d{6}\.wav$')


if __name__ == '__main__':
    unittest.main()
