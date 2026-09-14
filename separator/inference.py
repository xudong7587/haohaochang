"""Demucs execution and validation, independent of HTTP routing and state storage."""
import os
import subprocess
import sys
import wave
import math
from array import array
from pathlib import Path


def vocal_activity(file):
    """Energy onsets from the separated stem, not speech/lyric recognition."""
    levels = []
    with wave.open(str(file), 'rb') as audio:
        if audio.getsampwidth() != 2 or audio.getnchannels() != 1:
            raise ValueError('Expected mono PCM16 vocal analysis')
        rate = audio.getframerate()
        step = max(1, round(rate * 0.05))
        duration = audio.getnframes() / rate
        while raw := audio.readframes(step):
            samples = array('h', raw)
            if sys.byteorder != 'little':
                samples.byteswap()
            levels.append(math.sqrt(sum(float(v) * v for v in samples) / len(samples)) / 32768)
    positive = sorted(v for v in levels if v > 0.0001)
    if not positive:
        return dict(version=1, duration=duration, onsets=[])
    reference = positive[int((len(positive) - 1) * 0.9)]
    threshold = max(0.004, reference * 0.12)
    starts, start, quiet = [], None, 0
    # Require 0.5 seconds of sustained vocal energy; merge gaps below 0.3s.
    for index, value in enumerate(levels + [0] * 6):
        if value >= threshold:
            if start is None:
                start = index
            quiet = 0
        else:
            quiet += 1
            if start is not None and quiet >= 6:
                end = index - quiet + 1
                active = sum(v >= threshold for v in levels[start:end])
                if active >= 10:
                    starts.append(round(start * step / rate, 3))
                start = None
    return dict(version=1, duration=duration, onsets=starts[:1000])


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
            if os.getenv('SEPARATION_BACKEND') == 'openvino-npu':
                if model != 'htdemucs':
                    raise ValueError('NPU preview supports htdemucs only')
                command = [sys.executable, str(Path(__file__).with_name('npu_inference.py')),
                    str(folder / 'input.wav'), str(folder / 'out' / model / 'input')]
            else:
                command = [sys.executable, '-m', 'demucs', '--two-stems=vocals', '-n', model, '-d', device,
                    '-j', '1', '--segment', os.getenv('SEPARATION_SEGMENT', '7'), '-o', str(folder / 'out'), str(folder / 'input.wav')]
            subprocess.run(command, check=True, timeout=1800, stdout=log, stderr=log, **flags)
            store.write(job, dict(status='running', stage='validating'))
            # Decode once into PCM so a corrupt/truncated or float WAV cannot escape validation.
            subprocess.run([os.getenv('FFMPEG', 'ffmpeg'), '-y', '-v', 'error', '-xerror', '-i',
                str(folder / 'out' / model / 'input' / 'no_vocals.wav'), '-vn', '-c:a', 'pcm_s16le',
                str(folder / 'validated.wav')], check=True, timeout=300, stdout=log, stderr=log, **flags)
        validate_waves(folder / 'input.wav', folder / 'validated.wav')
        (folder / 'validated.wav').replace(folder / 'instrumental.wav')
        activity = None
        try:
            analysis = folder / 'vocal-analysis.wav'
            subprocess.run([os.getenv('FFMPEG', 'ffmpeg'), '-y', '-v', 'error', '-i',
                str(folder / 'out' / model / 'input' / 'vocals.wav'), '-ac', '1', '-ar', '16000',
                '-c:a', 'pcm_s16le', str(analysis)], check=True, timeout=300,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
            activity = vocal_activity(analysis)
        except Exception:
            pass  # Optional alignment must never discard a valid accompaniment.
        finally:
            (folder / 'vocal-analysis.wav').unlink(missing_ok=True)
        store.write(job, dict(status='done', instrumental_url=f'/artifacts/{job}', vocal_activity=activity))
    except Exception:
        store.write(job, dict(status='failed', retryable=True,
            error='Separation or output validation failed; check worker.log, model availability and device mapping'))
