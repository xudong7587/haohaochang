"""Protocol checks use temporary job storage and synthetic WAVs; no model download."""
import asyncio
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
from job_store import JobStore
from inference import validate_waves
from upload_guard import UploadGuard


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ktv-worker-')
        self.addCleanup(self.temp.cleanup)
        self.store = JobStore(Path(self.temp.name) / 'jobs')

    def test_restart_marks_all_unfinished_states_retryable_and_preserves_done(self):
        ids = []
        for state in ('uploading', 'queued', 'running', 'done'):
            job, _ = self.store.reserve('htdemucs', 'test')
            self.store.write(job, dict(status=state))
            (self.store.root / job / 'input.part').write_bytes(b'incomplete')
            ids.append(job)
        reopened = JobStore(self.store.root)
        reopened.recover()
        for job in ids[:3]:
            self.assertEqual(reopened.state(job)['stage'], 'interrupted')
            self.assertTrue(reopened.state(job)['retryable'])
            self.assertFalse((reopened.root / job / 'input.part').exists())
        self.assertEqual(reopened.state(ids[3])['status'], 'done')

    def test_reservations_include_uploading_and_deduplicate_across_restart(self):
        job, created = self.store.reserve('htdemucs', 'test', 'request-1', capacity=1)
        self.assertTrue(created)
        self.assertEqual(self.store.pending(), 1)
        self.assertEqual(JobStore(self.store.root).reserve('htdemucs', 'test', 'request-1'), (job, False))
        with self.assertRaises(OverflowError):
            self.store.reserve('htdemucs', 'other', capacity=1)
        with self.assertRaises(ValueError):
            self.store.reserve('htdemucs_ft', 'test', 'request-1')

    def test_parallel_reservations_do_not_exceed_capacity(self):
        import concurrent.futures
        def reserve(i):
            try:
                return self.store.reserve('htdemucs', str(i), capacity=2)
            except OverflowError:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(reserve, range(20)))
        self.assertEqual(sum(result is not None for result in results), 2)
        self.assertEqual(self.store.pending(), 2)

    def test_actual_wav_frames_reject_short_output(self):
        def create(name, duration):
            target = Path(self.temp.name) / name
            with wave.open(str(target), 'wb') as audio:
                audio.setnchannels(2)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(bytes(round(duration * 8000) * 4))
            return target
        source = create('source.wav', 2)
        validate_waves(source, create('matching.wav', 2))
        with self.assertRaisesRegex(ValueError, 'duration'):
            validate_waves(source, create('short.wav', 0.2))


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_limit_applies_before_downstream_body_parser(self):
        started = asyncio.Event()
        release = asyncio.Event()
        async def downstream(scope, receive, send):
            started.set()
            await release.wait()
        guard = UploadGuard(downstream, concurrency=1)
        scope = dict(type='http', method='POST', path='/separate', headers=[])
        responses = []
        async def receive():
            return dict(type='http.request', body=b'')
        async def send(message):
            responses.append(message)
        first = asyncio.create_task(guard(scope, receive, send))
        await started.wait()
        await guard(scope, receive, send)
        self.assertEqual(responses[0]['status'], 429)
        release.set()
        await first
        # The slot is released after completion.
        await guard(scope, receive, send)

    async def test_declared_large_body_rejected_without_parser(self):
        async def downstream(*args):
            self.fail('Should not parse oversized request')
        messages = []
        async def send(message):
            messages.append(message)
        await UploadGuard(downstream, max_bytes=4)(dict(type='http', method='POST', path='/separate',
            headers=[(b'content-length', b'5')]), None, send)
        self.assertEqual(messages[0]['status'], 413)


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ktv-worker-routes-')
        cls.previous_data = os.environ.get('SEPARATION_DATA_DIR')
        cls.previous_key = os.environ.get('SEPARATION_API_KEY')
        os.environ['SEPARATION_DATA_DIR'] = cls.temp.name
        os.environ['SEPARATION_API_KEY'] = 'test-only'
        cls.module = importlib.import_module('app')
        from fastapi.testclient import TestClient
        cls.client = TestClient(cls.module.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.module.pool.shutdown(wait=True)
        for key, value in [('SEPARATION_DATA_DIR', cls.previous_data), ('SEPARATION_API_KEY', cls.previous_key)]:
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        cls.temp.cleanup()

    def test_legacy_submission_and_idempotent_retry_share_one_job(self):
        with patch.object(self.module.pool, 'submit') as submit:
            headers = {'Authorization':'Bearer test-only', 'Idempotency-Key':'nas-retry'}
            def post():
                return self.client.post('/separate', data={'model':'htdemucs', 'title':'测试'},
                    files={'file':('input.m4a', b'fake-input')}, headers=headers)
            first, second = post(), post()
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['id'], second.json()['id'])
            self.assertEqual(submit.call_count, 1)
            health = self.client.get('/health', headers=headers).json()
            self.assertEqual(health['protocol'], 'ktv-separation-v1')
            self.assertTrue(health['busy'])
            self.assertEqual(self.client.get('/health').status_code, 401)
            # Existing clients without the new header are still supported.
            headers.pop('Idempotency-Key')
            legacy = post()
            self.assertEqual(legacy.status_code, 200)
            self.assertNotEqual(legacy.json()['id'], first.json()['id'])

    def test_empty_upload_fails_and_releases_pending_reservation(self):
        pending = self.module.jobs.pending()
        response = self.client.post('/separate', data={'model':'htdemucs'}, files={'file':('input.m4a', b'')},
                                    headers={'Authorization':'Bearer test-only'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.module.jobs.pending(), pending)

    def test_chunked_oversized_multipart_is_rejected_with_413(self):
        from fastapi import FastAPI, File, UploadFile
        from fastapi.testclient import TestClient
        limited = FastAPI()
        limited.add_middleware(UploadGuard, max_bytes=100)
        @limited.post('/separate')
        async def upload(file: UploadFile = File(...)):
            self.fail('Oversized multipart must not reach the handler')
        body = (b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="input.m4a"\r\n'
                b'Content-Type: audio/mp4\r\n\r\n' + b'a' * 200 + b'\r\n--boundary--\r\n')
        with TestClient(limited) as client:
            response = client.post('/separate', content=iter([body[:60], body[60:]]),
                headers={'Content-Type':'multipart/form-data; boundary=boundary'})
        self.assertEqual(response.status_code, 413)


if __name__ == '__main__':
    unittest.main()
