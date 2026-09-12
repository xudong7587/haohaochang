"""Opt-in synthetic end-to-end check inside the NPU preview container.

Run: docker exec <npu-container> python /app/smoke_npu.py
Creates one synthetic separation job; never reads the user's library.
"""
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
import uuid
import wave
import numpy as np

def request(path, data=None, content_type=None):
    key = os.getenv('SEPARATION_API_KEY', '')
    headers = {'Authorization': 'Bearer ' + key} if key else {}
    if content_type: headers['Content-Type'] = content_type
    return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000' + path,
        data=data, headers=headers), timeout=20)

deadline = time.monotonic() + 300
while True:
    try:
        with request('/health') as response: health = json.load(response)
    except urllib.error.URLError:
        if time.monotonic() > deadline: raise
        time.sleep(1)
        continue
    if health.get('ready'): break
    if time.monotonic() > deadline: raise RuntimeError(health.get('qualification'))
    time.sleep(2)
print('QUALIFIED', health['qualification'], flush=True)
with tempfile.TemporaryDirectory(prefix='hhc-npu-smoke-') as directory:
    root = Path(directory)
    rate, duration = 44100, 16.2
    t = np.arange(round(rate * duration)) / rate
    audio = np.stack([0.2*np.sin(2*np.pi*220*t), 0.18*np.sin(2*np.pi*330*t)], axis=1)
    with wave.open(str(root/'source.wav'), 'wb') as source:
        source.setparams((2,2,rate,0,'NONE','not compressed'))
        source.writeframes(np.rint(audio*32768).astype('<i2').tobytes())
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(root/'source.wav'),'-c:a','aac',str(root/'source.m4a')], check=True)
    boundary = 'hhc-' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nhtdemucs\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="input.m4a"\r\nContent-Type: audio/mp4\r\n\r\n').encode()
    body += (root/'source.m4a').read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    start = time.monotonic()
    with request('/separate', body, f'multipart/form-data; boundary={boundary}') as response: job = json.load(response)
    job_id = job['id']
    while job['status'] in ('queued','running'):
        if time.monotonic()-start > 300: raise TimeoutError(job)
        time.sleep(1)
        with request('/jobs/'+job_id) as response: job=json.load(response)
    assert job['status'] == 'done', job
    with request('/artifacts/'+job_id) as response: raw=response.read()
    with wave.open(io.BytesIO(raw)) as result:
        actual_duration = result.getnframes()/result.getframerate()
        assert abs(actual_duration-duration)<0.1, actual_duration
        assert result.getnchannels()==2 and result.getsampwidth()==2
        samples=np.frombuffer(result.readframes(result.getnframes()),dtype='<i2')
        assert samples.size and np.max(np.abs(samples.astype(float)))>0
    print('PASS: HTTP upload -> NPU multi-segment inference -> validation -> artifact',
        dict(job=job_id,input_seconds=duration,output_seconds=actual_duration,elapsed_seconds=round(time.monotonic()-start,3)),flush=True)
