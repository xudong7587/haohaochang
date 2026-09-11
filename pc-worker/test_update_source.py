import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from email.message import Message
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'separator'))
from job_store import JobStore
from updater import UpdateManager
from update_source import API, INDEX_URL, REPO, CHECK_INTERVAL, fetch_release, check_failure, allowed_url, Redirects


def index():
    return dict(schema=1, version='0.4.4', notes='更新说明',
                pc=dict(url=f'https://github.com/{REPO}/releases/download/v0.4.4/haohaochang-resource-ai-v0.4.4.zip',
                        sha256='a' * 64, size=12345))


def api_release():
    data = index()
    return dict(tag_name='v0.4.4', draft=False, prerelease=False, body='更新说明',
                assets=[dict(name='haohaochang-resource-ai-v0.4.4.zip', browser_download_url=data['pc']['url'],
                             digest='sha256:' + data['pc']['sha256'], size=data['pc']['size'])])


def response(data):
    return io.BytesIO(json.dumps(data).encode())


class UpdateSourceTest(unittest.TestCase):
    def test_index_bypasses_api_and_repeated_clicks_use_cache(self):
        calls, now = [], [1000]
        def transport(url):
            calls.append(url)
            self.assertEqual(url, INDEX_URL, 'The new channel must never require an API token or quota')
            return response(index())
        with tempfile.TemporaryDirectory() as temp, patch('updater.VERSION', '0.4.1'):
            jobs = JobStore(Path(temp) / 'jobs')
            manager = UpdateManager(temp, jobs, {}, lambda: self.fail('check must not stop worker'), transport, clock=lambda: now[0])
            state = manager.check()
            self.assertEqual(state['phase'], 'available')
            self.assertEqual(state['latest'], '0.4.4')
            self.assertEqual(manager.release['url'], index()['pc']['url'])
            self.assertEqual(manager.check(), state)
            self.assertEqual(calls, [INDEX_URL])
            self.assertTrue(jobs.accepting)
            now[0] += CHECK_INTERVAL + 1
            manager.check()
            self.assertEqual(calls, [INDEX_URL, INDEX_URL])

    def test_old_release_missing_index_uses_api(self):
        calls = []
        def transport(url):
            calls.append(url)
            if url == INDEX_URL:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            self.assertEqual(url, API)
            return response(api_release())
        release, notes = fetch_release(transport)
        self.assertEqual(calls, [INDEX_URL, API])
        self.assertEqual(release['digest'], 'a' * 64)
        self.assertEqual(release['version'], '0.4.4')
        self.assertEqual(notes, '更新说明')

    def test_rate_limit_obeys_reset_and_survives_restart(self):
        calls, now = [], [1000]
        headers = Message()
        headers['X-RateLimit-Reset'] = '4600'
        headers['Retry-After'] = '120'
        def transport(url):
            calls.append(url)
            raise urllib.error.HTTPError(url, 403 if url == API else 404, 'rate limit exceeded', headers, None)
        with tempfile.TemporaryDirectory() as temp:
            jobs = JobStore(Path(temp) / 'jobs')
            manager = UpdateManager(temp, jobs, {}, lambda: None, transport, clock=lambda: now[0])
            state = manager.check()
            self.assertEqual(state['phase'], 'failed')
            self.assertEqual(state['nextCheck'], 4600)
            self.assertIn('手动下载更新包', state['error'])
            self.assertIsNone(manager.release)
            self.assertTrue(jobs.accepting)
            for _ in range(3): manager.check()
            restarted = UpdateManager(temp, jobs, {}, lambda: None, transport, clock=lambda: now[0])
            restarted.check()
            self.assertEqual(calls, [INDEX_URL, API])
            now[0] = 4601
            restarted.check()
            self.assertEqual(calls, [INDEX_URL, API, INDEX_URL, API])

    def test_secondary_limit_retry_after_and_network_errors(self):
        headers = Message(); headers['Retry-After'] = '180'
        error = urllib.error.HTTPError(API, 429, 'slow down', headers, None)
        self.assertEqual(check_failure(error, 1000)[1], 1180)
        del headers['Retry-After']
        headers['Retry-After'] = 'Thu, 01 Jan 1970 01:00:00 GMT'
        self.assertEqual(check_failure(error, 1000)[1], 3600)
        del headers['Retry-After']
        headers['Retry-After'] = 'inf'
        headers['X-RateLimit-Reset'] = 'not-a-number'
        self.assertEqual(check_failure(error, 1000)[1], 1060)
        text, when = check_failure(urllib.error.URLError('timed out'), 1000)
        self.assertIn('连接更新服务失败', text)
        self.assertEqual(when, 1060)

    def test_invalid_index_never_silently_falls_back(self):
        for patch_values in [dict(url='https://evil.example/update.zip'), dict(url=index()['pc']['url'].replace('v0.4.4/', 'v0.4.3/')),
                             dict(sha256=''), dict(size=True), dict(size=0), dict(size=40 * 1024 * 1024)]:
            with self.subTest(patch_values=patch_values):
                data = index(); data['pc'].update(patch_values)
                calls = []
                def transport(url): calls.append(url); return response(data)
                with self.assertRaises(ValueError): fetch_release(transport)
                self.assertEqual(calls, [INDEX_URL])
        for data in [dict(schema=2, version='0.4.4', pc=index()['pc']), dict(schema=1, version='0.4.4-beta', pc=index()['pc']), []]:
            with self.assertRaises(ValueError): fetch_release(lambda url: response(data))
        with self.assertRaisesRegex(ValueError, '更新信息过大'):
            fetch_release(lambda url: io.BytesIO(b' ' * (64 * 1024 + 1)))

    def test_concurrent_check_is_single_flight(self):
        entered, finish = threading.Event(), threading.Event()
        calls = []
        def transport(url):
            calls.append(url); entered.set()
            self.assertTrue(finish.wait(5))
            return response(index())
        with tempfile.TemporaryDirectory() as temp:
            manager = UpdateManager(temp, JobStore(Path(temp) / 'jobs'), {}, lambda: None, transport)
            thread = threading.Thread(target=manager.check)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(manager.check()['phase'], 'checking')
            finally:
                finish.set(); thread.join(5)
            self.assertEqual(calls, [INDEX_URL])

    def test_redirects_only_allow_release_hosts(self):
        request = urllib.request.Request(INDEX_URL)
        target = f'https://github.com/{REPO}/releases/download/v0.4.4/haohaochang-pc-update.json'
        self.assertIsNotNone(Redirects().redirect_request(request, None, 302, 'Found', {}, target))
        for target in ['https://evil.example/file', 'http://github.com/' + REPO, 'https://api.github.com/rate_limit']:
            with self.assertRaises(ValueError): Redirects().redirect_request(request, None, 302, 'Found', {}, target)
        self.assertFalse(allowed_url('https://github.com:broken/file', True))


if __name__ == '__main__': unittest.main()
