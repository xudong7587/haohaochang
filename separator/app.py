"""Optional CPU Demucs worker implementing ktv-separation-v1."""
import concurrent.futures
import hmac
import json
import os
from pathlib import Path
import subprocess
import uuid
import sys
from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

ROOT = Path(os.getenv('SEPARATION_DATA_DIR', '/data')) / 'jobs'
ROOT.mkdir(parents=True, exist_ok=True)
pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
app = FastAPI()

def auth(authorization: str = Header(default='')):
    key = os.getenv('SEPARATION_API_KEY', '')
    if key and not hmac.compare_digest(authorization, 'Bearer ' + key):
        raise HTTPException(401, 'Invalid key')

def status(job, value):
    tmp = ROOT / job / 'state.tmp'
    tmp.write_text(json.dumps(dict(id=job, **value)))
    tmp.replace(ROOT / job / 'state.json')

# Interrupted third-party jobs must fail explicitly; NAS offers retry.
for state in ROOT.glob('*/state.json'):
    if json.loads(state.read_text()).get('status') in ('queued', 'running'):
        status(state.parent.name, dict(status='failed', error='Service restarted; retry from NAS'))

def separate(job, model):
    status(job, dict(status='running'))
    try:
        device = os.getenv('SEPARATION_DEVICE', 'cpu')
        if device == 'auto':
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        with (ROOT / job / 'worker.log').open('w', encoding='utf-8') as log:
            subprocess.run([os.getenv('FFMPEG', 'ffmpeg'), '-y', '-v', 'error', '-i', str(ROOT / job / 'input.m4a'), str(ROOT / job / 'input.wav')], check=True, timeout=300, stdout=log, stderr=log, **flags)
            subprocess.run([sys.executable, '-m', 'demucs', '--two-stems=vocals', '-n', model, '-d', device, '-j', '1', '-o', str(ROOT / job / 'out'), str(ROOT / job / 'input.wav')], check=True, timeout=1800, stdout=log, stderr=log, **flags)
        source = ROOT / job / 'out' / model / 'input' / 'no_vocals.wav'
        source.replace(ROOT / job / 'instrumental.wav')
        status(job, dict(status='done', instrumental_url=f'/artifacts/{job}'))
    except Exception:
        status(job, dict(status='failed', error='Demucs separation failed; check model availability and service logs'))

@app.get('/health', dependencies=[Depends(auth)])
def health():
    return dict(protocol='ktv-separation-v1', models=['htdemucs', 'htdemucs_ft'], device=os.getenv('SEPARATION_DEVICE', 'cpu'))

@app.post('/separate', dependencies=[Depends(auth)])
async def submit(file: UploadFile = File(...), model: str = Form(...)):
    if model not in ('htdemucs', 'htdemucs_ft'):
        raise HTTPException(400, 'Unsupported model')
    pending = sum(json.loads(s.read_text()).get('status') in ('queued', 'running') for s in ROOT.glob('*/state.json'))
    if pending >= 10:
        raise HTTPException(429, 'Queue full')
    job = uuid.uuid4().hex
    folder = ROOT / job
    folder.mkdir()
    size = 0
    try:
        with (folder / 'input.m4a').open('wb') as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(413, 'Audio exceeds 100 MB')
                target.write(chunk)
    finally:
        await file.close()
    status(job, dict(status='queued'))
    pool.submit(separate, job, model)
    return dict(id=job, status='queued')

def job_path(job):
    if len(job) != 32 or any(c not in '0123456789abcdef' for c in job):
        raise HTTPException(404, 'Unknown job')
    return ROOT / job

@app.get('/jobs/{job}', dependencies=[Depends(auth)])
def get_job(job: str):
    file = job_path(job) / 'state.json'
    if not file.exists():
        raise HTTPException(404, 'Unknown job')
    return json.loads(file.read_text())

@app.get('/artifacts/{job}', dependencies=[Depends(auth)])
def artifact(job: str):
    file = job_path(job) / 'instrumental.wav'
    if not file.exists():
        raise HTTPException(404, 'Not ready')
    return FileResponse(file, media_type='audio/wav')
