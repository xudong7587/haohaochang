import hashlib
import io
import os
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile
import subprocess
import socket
import time
import urllib.request
import importlib.util

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'separator'))
from job_store import JobStore
from updater import UpdateManager, unpack, safe_name, allowed_url, version, release_asset
from update_runner import apply, rollback
import update_runner


def bundle(files=None):
    files = files or {n: b'new' for n in ('run.py','start.ps1','version.py','updater.py','update_runner.py')}
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        for name, value in files.items():
            z.writestr(name, value)
        z.writestr('update-manifest.json', json.dumps({'version':'0.3.11', 'files':{n:hashlib.sha256(v).hexdigest() for n,v in files.items()}}))
    return data.getvalue()


class UpdateTest(unittest.TestCase):
    def test_versioned_asset_matches_release_and_takes_precedence_over_legacy(self):
        legacy={'name':'haohaochang-resource-ai.zip'}
        current={'name':'haohaochang-resource-ai-v0.4.0.zip'}
        wrong={'name':'haohaochang-resource-ai-v0.4.1.zip'}
        self.assertEqual(release_asset([wrong, legacy, current], 'v0.4.0'), current)
        self.assertEqual(release_asset([legacy], '0.3.14'), legacy)
        self.assertIsNone(release_asset([wrong], '0.4.0'))
        with self.assertRaises(ValueError): release_asset([current], '0.4.0-beta')
    def test_authenticated_desktop_api_and_busy_exit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with patch.dict(os.environ,{'SEPARATION_DATA_DIR':str(root/'data'),'SEPARATION_API_KEY':'fixture-desktop-key'}):
                spec=importlib.util.spec_from_file_location('app',Path(__file__).resolve().parents[1]/'separator/app.py')
                module=importlib.util.module_from_spec(spec)
                with patch.dict(sys.modules,{'app':module}):
                    spec.loader.exec_module(module)
                    from desktop import register
                    from fastapi.testclient import TestClient
                    stopped=[]
                    register(module.app,root,dict(port=0,host='127.0.0.1'),dict(runtime='fixture'),'cpu',lambda:stopped.append(True))
                    with TestClient(module.app) as client:
                        self.assertEqual(client.post('/desktop/update/check').status_code,401)
                        headers={'Authorization':'Bearer fixture-desktop-key'}
                        status=client.get('/desktop/status',headers=headers)
                        self.assertEqual(status.status_code,200)
                        self.assertEqual(status.json()['update']['phase'],'idle')
                        self.assertEqual(client.post('/desktop/update/install',headers=headers,json={'version':'0.3.11'}).status_code,409)
                        job,_=module.jobs.reserve('model','current')
                        self.assertEqual(client.post('/desktop/shutdown',headers=headers).status_code,409)
                        self.assertTrue(module.jobs.accepting)
                        module.jobs.write(job,dict(status='done'))
                        self.assertEqual(client.post('/desktop/shutdown',headers=headers).status_code,200)
                        self.assertEqual(stopped,[True]);self.assertFalse(module.jobs.accepting)

    def test_paths_and_versions(self):
        for name in ('../run.py','/run.py','ui/../../run.py','worker.json','runtime/a.py','data/a.py','ui\\foo.js','A:bad.py','ui/../a.js','run.py.'):
            self.assertFalse(safe_name(name), name)
        for url in ('http://github.com/xudong7587/haohaochang/releases/download/v1/a', 'https://github.com/other/repo/releases/download/v1/a','https://github.com@evil.com/xudong7587/haohaochang/releases/download/v1/a'):
            self.assertFalse(allowed_url(url, True))
        self.assertTrue(allowed_url('https://github.com/xudong7587/haohaochang/releases/download/v0.3.11/a',True))
        self.assertGreater(version('0.3.10'), version('0.3.9'))

    def test_manifest_and_protected_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            names = unpack(io.BytesIO(bundle()), root/'new', '0.3.11')
            (root/'worker.json').write_text('key')
            (root/'run.py').write_text('old')
            (root/'data').mkdir(); (root/'data/model.bin').write_bytes(b'model')
            apply(root, root, names)
            self.assertEqual((root/'run.py').read_text(),'new')
            rollback(root,root)
            self.assertEqual((root/'run.py').read_text(),'old')
            self.assertFalse((root/'version.py').exists())
            self.assertEqual((root/'worker.json').read_text(),'key')
            self.assertEqual((root/'data/model.bin').read_bytes(),b'model')
            for files in ({'../run.py':b'evil'}, {'worker.json':b'evil'}, {'run.py':b'a','RUN.py':b'b'}):
                with self.assertRaises(ValueError):
                    unpack(io.BytesIO(bundle(files)),root/'bad','0.3.11')

    def test_failed_replace_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'new').mkdir()
            (root/'new/run.py').write_text('new'); (root/'run.py').write_text('old')
            with self.assertRaises(FileNotFoundError):
                apply(root,root,['run.py','missing.py'])
            rollback(root,root)
            self.assertEqual((root/'run.py').read_text(),'old')

    def test_bad_digest_keeps_queue_open(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); jobs = JobStore(root/'jobs')
            manager = UpdateManager(root,jobs,{},lambda: self.fail('must not stop'),transport=lambda url:io.BytesIO(b'bad'))
            manager.download(dict(url='unused',size=3,digest='0'*64,version='0.3.11'))
            self.assertEqual(manager.snapshot()['phase'],'failed')
            self.assertTrue(jobs.accepting)

    def test_drain_rejects_new_admission_and_cancel_resumes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); jobs = JobStore(root/'jobs')
            job,_ = jobs.reserve('model','one','existing')
            data = bundle()
            manager = UpdateManager(root,jobs,{},lambda:self.fail('busy worker must not stop'),transport=lambda url:io.BytesIO(data))
            waiting = threading.Event()
            original = manager.set_state
            def state(**values):
                original(**values)
                if values.get('phase') == 'waiting': waiting.set()
            manager.set_state = state
            thread = threading.Thread(target=manager.download,args=(dict(url='unused',size=len(data),digest=hashlib.sha256(data).hexdigest(),version='0.3.11'),))
            thread.start(); self.assertTrue(waiting.wait(5))
            with self.assertRaises(OverflowError): jobs.reserve('model','new')
            self.assertEqual(jobs.reserve('model','one','existing'),(job,False))
            manager.cancel(); thread.join(5); self.assertFalse(thread.is_alive())
            self.assertTrue(jobs.accepting); self.assertEqual(manager.snapshot()['phase'],'cancelled')

    def test_no_downgrade_or_unchecked_install(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); manager=UpdateManager(root,JobStore(root/'jobs'),{},lambda:None)
            with self.assertRaises(ValueError): manager.install('0.3.11')
            with self.assertRaises(ValueError): manager.cancel()

    def test_restart_and_failed_start_restore_real_local_service(self):
        for broken in (False, True):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as temp:
                root=Path(temp); folder=root/'data/updates/fixture'; (folder/'new').mkdir(parents=True)
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
                (root/'worker.json').write_text(json.dumps(dict(port=port,key='isolated-key')),encoding='utf-8')
                template = '''import json
from http.server import HTTPServer,BaseHTTPRequestHandler
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.headers.get('Authorization') != 'Bearer isolated-key': self.send_error(401); return
  self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'version':VERSION}).encode())
 def log_message(self,*args): pass
HTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
'''.replace('PORT',str(port))
                old="VERSION='0.3.10'\n"+template
                (root/'run.py').write_text(old,encoding='utf-8')
                (folder/'new/run.py').write_text("raise RuntimeError('broken release')" if broken else "VERSION='0.3.11'\n"+template,encoding='utf-8')
                (folder/'plan.json').write_text(json.dumps(dict(root=str(root),files=['run.py'],version='0.3.11',pid=os.getpid(),created=0)),encoding='utf-8')
                children=[]
                def launch(root,folder):
                    child=subprocess.Popen([sys._base_executable,str(root/'run.py')],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                    children.append(child);return child
                try:
                    with patch.object(update_runner,'launch',launch): update_runner.run(folder,startup_timeout=1.5,poll_interval=0.05)
                    state=json.loads((folder.parent/'status.json').read_text(encoding='utf-8'))
                    self.assertEqual(state['phase'],'failed' if broken else 'complete')
                    self.assertEqual(json.loads((root/'worker.json').read_text())['key'],'isolated-key')
                    if broken:self.assertEqual((root/'run.py').read_text(),old)
                    deadline=time.monotonic()+3
                    while True:
                        try:
                            req=urllib.request.Request(f'http://127.0.0.1:{port}/desktop/status',headers={'Authorization':'Bearer isolated-key'})
                            with urllib.request.urlopen(req,timeout=1) as response: data=json.load(response)
                            break
                        except OSError:
                            if time.monotonic()>deadline:raise
                            time.sleep(.05)
                    self.assertEqual(data['version'],'0.3.10' if broken else '0.3.11')
                finally:
                    for child in children:
                        if child.poll() is None:child.terminate()
                        child.wait(timeout=5)


if __name__ == '__main__': unittest.main()
