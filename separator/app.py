"""ktv-separation-v1 routes shared by the CPU container and PC launcher."""
import concurrent.futures
import hmac
import os
from pathlib import Path
from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from job_store import JobStore
from inference import separate as execute_separation
from upload_guard import UploadGuard

ROOT = Path(os.getenv('SEPARATION_DATA_DIR', '/data')) / 'jobs'
jobs = JobStore(ROOT)
jobs.recover()
pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
app = FastAPI()
app.add_middleware(UploadGuard)


def auth(authorization: str = Header(default='')):
    key = os.getenv('SEPARATION_API_KEY', '')
    if key and not hmac.compare_digest(authorization, 'Bearer ' + key):
        raise HTTPException(401, 'Invalid key')


def status(job, value):
    jobs.write(job, value)


def separate(job, model):
    execute_separation(jobs, job, model)


@app.get('/health', dependencies=[Depends(auth)])
def health():
    pending = jobs.pending()
    return dict(protocol='ktv-separation-v1', models=['htdemucs', 'htdemucs_ft'],
        lanEnabled=getattr(app.state, 'lan', {}).get('enabled', False),
        device=os.getenv('SEPARATION_DEVICE', 'cpu'), pending=pending, busy=pending > 0,
        capabilities=['idempotency-key', 'upload-limit', 'restart-recovery', 'video-clip-v1'])


@app.post('/separate', dependencies=[Depends(auth)])
async def submit(file: UploadFile = File(...), model: str = Form(...), title: str = Form(default=''),
                 idempotency_key: str = Header(default='')):
    job = None
    created = False
    try:
        if model not in ('htdemucs', 'htdemucs_ft'):
            raise HTTPException(400, 'Unsupported model')
        if len(idempotency_key) > 120 or any(not (c.isascii() and (c.isalnum() or c in '_-')) for c in idempotency_key):
            raise HTTPException(400, 'Invalid idempotency key')
        try:
            job, created = jobs.reserve(model, title, idempotency_key)
        except OverflowError:
            raise HTTPException(429, 'Queue full', headers={'Retry-After':'3'})
        except ValueError as error:
            raise HTTPException(409, str(error))
        if not created:
            result = jobs.state(job)
            if result.get('status') == 'uploading':
                raise HTTPException(409, 'Original upload is still in progress', headers={'Retry-After':'3'})
            return result
        folder = ROOT / job
        size = 0
        with (folder / 'input.part').open('wb') as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(413, 'Audio exceeds 100 MB')
                target.write(chunk)
        if not size:
            raise HTTPException(400, 'Empty audio')
        (folder / 'input.part').replace(folder / 'input.m4a')
        status(job, dict(status='queued'))
        pool.submit(separate, job, model)
        return dict(id=job, status='queued')
    except BaseException:
        if created:
            (ROOT / job / 'input.part').unlink(missing_ok=True)
            status(job, dict(status='failed', stage='upload', retryable=True, error='Upload interrupted or rejected; retry from NAS'))
        raise
    finally:
        await file.close()


def job_path(job):
    if len(job) != 32 or any(c not in '0123456789abcdef' for c in job):
        raise HTTPException(404, 'Unknown job')
    return ROOT / job


@app.get('/jobs/{job}', dependencies=[Depends(auth)])
def get_job(job: str):
    if not job_path(job).is_dir():
        raise HTTPException(404, 'Unknown job')
    return jobs.state(job)


@app.get('/artifacts/{job}', dependencies=[Depends(auth)])
def artifact(job: str):
    file = job_path(job) / 'instrumental.wav'
    if jobs.state(job).get('status') != 'done' or not file.exists():
        raise HTTPException(404, 'Not ready')
    return FileResponse(file, media_type='audio/wav')


from clipping import register as register_clipping
register_clipping(app, auth, jobs, pool, job_path)
