"""Accurate video trimming shares the worker queue with separation."""
import math
import os
import subprocess
from fastapi import Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse


def execute_clip(jobs, job, start, end, video_only=False):
    folder = jobs.root / job
    jobs.write(job, dict(status='running', stage='preparing-video-pc' if video_only else 'clipping'))
    try:
        with (folder / 'worker.log').open('wb') as log:
            command = [os.getenv('FFMPEG', 'ffmpeg'), '-nostdin', '-y', '-v', 'error',
                '-ss', str(start), '-i', str(folder / 'input.mp4'), '-t', str(end-start),
                '-map', '0:v:0']
            if video_only:
                command += ['-an', '-vf', "scale=w='trunc(iw/2)*2':h=-2", '-pix_fmt', 'yuv420p']
            else:
                command += ['-map', '0:a:0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']
            gpu = video_only and os.getenv('SEPARATION_DEVICE') == 'cuda'
            encoders = [(['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '22', '-b:v', '0'], 'NVIDIA NVENC')] if gpu else []
            encoders.append((['-c:v', 'libx264', '-preset', 'veryfast' if video_only else 'fast', '-crf', '22' if video_only else '20'], 'CPU libx264'))
            for index, (encoder, name) in enumerate(encoders):
                log.write(('Video encoder: ' + name + '\n').encode('utf-8')); log.flush()
                try:
                    selected = list(command)
                    if name == 'NVIDIA NVENC':
                        selected[1:1] = ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']
                        selected[selected.index('-vf') + 1] = "scale_cuda=w=iw:h=ih:format=yuv420p"
                        pixel = selected.index('-pix_fmt')
                        del selected[pixel:pixel + 2]
                    subprocess.run(selected + encoder + ['-movflags', '+faststart', str(folder / 'clip.mp4')],
                        stdout=log, stderr=log, timeout=1800, check=True,
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    break
                except subprocess.CalledProcessError:
                    if index == len(encoders) - 1: raise
                    log.write(b'NVENC unavailable; retrying video on PC CPU.\n'); log.flush()
        jobs.write(job, dict(status='done', stage='done', video_url=f'/clip-artifacts/{job}'))
    except (OSError, subprocess.SubprocessError) as error:
        jobs.write(job, dict(status='failed', stage='preparing-video-pc' if video_only else 'clipping', error=str(error)[-600:]))


def register(app, auth, jobs, pool, job_path):
    @app.post('/clip', dependencies=[Depends(auth)])
    async def submit(file: UploadFile = File(...), start: float = Form(...), end: float = Form(...),
                     title: str = Form(default=''), video_only: bool = Form(default=False), idempotency_key: str = Header(default='')):
        created = False
        job = None
        try:
            if not all(math.isfinite(n) for n in (start, end)) or start < 0 or end <= start or end > 21600:
                raise HTTPException(400, 'Invalid clip range')
            if len(idempotency_key) > 120 or any(not (c.isascii() and (c.isalnum() or c in '_-')) for c in idempotency_key):
                raise HTTPException(400, 'Invalid idempotency key')
            try:
                job, created = jobs.reserve(f'{"video" if video_only else "clip"}:{start}:{end}', title, idempotency_key)
            except OverflowError:
                raise HTTPException(429, 'Queue full')
            except ValueError as error:
                raise HTTPException(409, str(error))
            if not created:
                result = jobs.state(job)
                if result.get('status') == 'uploading':
                    raise HTTPException(409, 'Upload in progress')
                return result
            folder = jobs.root / job
            size = 0
            with (folder / 'input.part').open('wb') as target:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 1024**3:
                        raise HTTPException(413, 'Video exceeds 1 GB')
                    target.write(chunk)
            if not size:
                raise HTTPException(400, 'Empty video')
            (folder / 'input.part').replace(folder / 'input.mp4')
            jobs.write(job, dict(status='queued', stage='clipping'))
            pool.submit(execute_clip, jobs, job, start, end, video_only)
            return dict(id=job, status='queued')
        except BaseException:
            if created:
                (jobs.root / job / 'input.part').unlink(missing_ok=True)
                jobs.write(job, dict(status='failed', stage='upload', error='Upload interrupted; retry from NAS'))
            raise
        finally:
            await file.close()

    @app.get('/clip-artifacts/{job}', dependencies=[Depends(auth)])
    def artifact(job: str):
        file = job_path(job) / 'clip.mp4'
        if jobs.state(job).get('status') != 'done' or not file.is_file():
            raise HTTPException(404, 'Not ready')
        return FileResponse(file, media_type='video/mp4')
