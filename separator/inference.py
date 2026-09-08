"""Demucs execution and validation, independent of HTTP routing and state storage."""
import os
import subprocess
import sys
import wave


def wave_duration(file):
    with wave.open(str(file), 'rb') as audio:
        if audio.getnchannels() not in (1, 2) or audio.getnframes() <= 0:
            raise ValueError('Invalid audio output')
        return audio.getnframes() / audio.getframerate()


def validate_waves(source, output):
    before, after = wave_duration(source), wave_duration(output)
    if abs(before - after) > max(0.25, min(1, before * 0.005)):
        raise ValueError('Separation output duration does not match input')


def separate(store, job, model):
    folder = store.root / job
    store.write(job, dict(status='running', stage='decoding'))
    try:
        device = os.getenv('SEPARATION_DEVICE', 'cpu')
        if device == 'auto':
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        with (folder / 'worker.log').open('w', encoding='utf-8') as log:
            subprocess.run([os.getenv('FFMPEG', 'ffmpeg'), '-y', '-v', 'error', '-i', str(folder / 'input.m4a'),
                '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', str(folder / 'input.wav')],
                check=True, timeout=300, stdout=log, stderr=log, **flags)
            store.write(job, dict(status='running', stage='separating'))
            subprocess.run([sys.executable, '-m', 'demucs', '--two-stems=vocals', '-n', model, '-d', device,
                '-j', '1', '--segment', os.getenv('SEPARATION_SEGMENT', '7'), '-o', str(folder / 'out'),
                str(folder / 'input.wav')], check=True, timeout=1800, stdout=log, stderr=log, **flags)
            store.write(job, dict(status='running', stage='validating'))
            # Decode once into PCM so a corrupt/truncated or float WAV cannot escape validation.
            subprocess.run([os.getenv('FFMPEG', 'ffmpeg'), '-y', '-v', 'error', '-xerror', '-i',
                str(folder / 'out' / model / 'input' / 'no_vocals.wav'), '-vn', '-c:a', 'pcm_s16le',
                str(folder / 'validated.wav')], check=True, timeout=300, stdout=log, stderr=log, **flags)
        validate_waves(folder / 'input.wav', folder / 'validated.wav')
        (folder / 'validated.wav').replace(folder / 'instrumental.wav')
        store.write(job, dict(status='done', instrumental_url=f'/artifacts/{job}'))
    except Exception:
        store.write(job, dict(status='failed', retryable=True,
            error='Demucs separation or output validation failed; check model availability and service logs'))
