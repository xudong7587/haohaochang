"""Three concurrent worker requests, with isolated data and fake inference."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ConcurrencyTests(unittest.TestCase):
    def test_three_requests_execute_together_and_fourth_waits(self):
        with tempfile.TemporaryDirectory(prefix='ktv-three-pc-') as folder:
            script = r'''
import threading
from unittest.mock import patch
from fastapi.testclient import TestClient
import app
assert app.CONCURRENCY == 3
started = threading.Barrier(4)
release = threading.Event()
def execute(job, model):
    app.jobs.write(job, dict(status='running', stage='separating'))
    (app.ROOT / job / 'worker.log').write_text(' 42%|####', encoding='utf-8')
    if model == 'htdemucs':
        started.wait(timeout=5)
    release.wait(timeout=5)
    app.jobs.write(job, dict(status='done'))
with TestClient(app.app) as client, patch.object(app, 'separate', side_effect=execute):
    ids=[]
    try:
        for i in range(3):
            response=client.post('/separate', data={'model':'htdemucs','title':'song-'+str(i)}, files={'file':('input.m4a',b'test')})
            assert response.status_code == 200, response.text
            ids.append(response.json()['id'])
        started.wait(timeout=5)
        for job in ids:
            state=client.get('/jobs/'+job).json()
            assert state['status'] == 'running'
            assert state['model_progress'] == 42
        health=client.get('/health').json()
        assert health['concurrency'] == 3 and health['busy'] and health['pending'] == 3
        response=client.post('/separate', data={'model':'htdemucs_ft','title':'queued'}, files={'file':('input.m4a',b'test')})
        fourth=response.json()['id']
        assert client.get('/jobs/'+fourth).json()['status'] == 'queued'
    finally:
        release.set()
        app.pool.shutdown(wait=True)
    assert all(app.jobs.state(job)['status']=='done' for job in ids+[fourth])
'''
            env = {**os.environ, 'SEPARATION_DATA_DIR':folder, 'SEPARATION_CONCURRENCY':'3', 'SEPARATION_API_KEY':'', 'PYTHONUTF8':'1'}
            result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parent,
                                    env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
