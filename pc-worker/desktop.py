"""Local dashboard for the resource AI worker; all operational data require its key."""
import json
import os
import subprocess
import time
from pathlib import Path
from fastapi import Depends
from fastapi.responses import FileResponse
import psutil


def register(app, root, config, plan, device):
    from app import auth, ROOT
    started = time.time()

    @app.get('/ui', include_in_schema=False)
    def ui():
        return FileResponse(root / 'ui' / 'index.html')

    @app.get('/icon.svg', include_in_schema=False)
    def icon():
        return FileResponse(root / 'ui' / 'icon.svg', media_type='image/svg+xml')

    @app.get('/desktop/status', dependencies=[Depends(auth)])
    def dashboard():
        jobs = []
        files = sorted(ROOT.glob('*/state.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        for file in files[:40]:
            try:
                state = json.loads(file.read_text())
                info = file.parent / 'info.json'
                state.update(json.loads(info.read_text(encoding='utf-8')) if info.exists() else {})
                state['updated'] = file.stat().st_mtime
                log = file.parent / 'worker.log'
                if log.exists():
                    with log.open('rb') as stream:
                        stream.seek(max(0, log.stat().st_size - 5000))
                        state['log'] = stream.read().decode('utf-8', errors='replace')
                jobs.append(state)
            except (OSError, ValueError):
                continue
        memory = psutil.virtual_memory()
        gpu = None
        if device == 'cuda':
            try:
                result = subprocess.run(['nvidia-smi', '-i', str(plan.get('gpu_index', 0)),
                    '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu',
                    '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=True)
                values = [float(v.strip()) for v in result.stdout.strip().split(',')]
                gpu = dict(utilization=values[0], used_mb=values[1], total_mb=values[2], temperature=values[3])
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
        return dict(name='好好唱资源 AI 整理器', device=device, gpu_name=plan.get('gpu_name'),
                    model='htdemucs', segment=float(os.environ.get('SEPARATION_SEGMENT', 4)),
                    runtime=plan['runtime'], host=config.get('host', '127.0.0.1'), port=config['port'],
                    uptime=round(time.time()-started), cpu=psutil.cpu_percent(),
                    memory=dict(used_gb=round(memory.used/1024**3, 1), total_gb=round(memory.total/1024**3, 1), percent=memory.percent),
                    gpu=gpu, jobs=jobs)
