"""Experimental htdemucs OpenVINO NPU backend, bounded-memory overlap/add.

Model: Intel/demucs-openvino (MIT). Uses htdemucs STFT conventions:
44.1 kHz, 4096 FFT, 1024 hop, 7.8 s segments, 25% overlap, no shift ensemble.
No implicit CPU fallback: the NAS orchestrator selects the external provider.
"""
import os
from pathlib import Path
import wave
import numpy as np

RATE, FFT, HOP, SEGMENT = 44100, 4096, 1024, 343980
FRAMES = 336
STRIDE = SEGMENT * 3 // 4
WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FFT) / FFT)).astype(np.float32)

def spectrum(audio):
    padded = np.pad(audio, ((0, 0), (1536, 1536 + FRAMES * HOP - SEGMENT)), mode='reflect')
    padded = np.pad(padded, ((0, 0), (FFT // 2, FFT // 2)), mode='reflect')
    frames = np.lib.stride_tricks.sliding_window_view(padded, FFT, axis=-1)[..., ::HOP, :]
    z = (np.fft.rfft(frames * WINDOW, axis=-1) / np.sqrt(FFT)).transpose(0, 2, 1)
    return z[:, :-1, 2:2 + FRAMES]

def inverse_spectrum(z):
    z = np.pad(z, ((0, 0), (0, 0), (0, 1), (2, 2)))
    frames = (np.fft.irfft(z, axis=-2) * np.sqrt(FFT)).astype(np.float32)
    length = (frames.shape[-1] - 1) * HOP + FFT
    audio = np.zeros((*z.shape[:2], length), dtype=np.float32)
    weight = np.zeros(length, dtype=np.float32)
    for i in range(frames.shape[-1]):
        audio[..., i * HOP:i * HOP + FFT] += frames[..., i] * WINDOW
        weight[i * HOP:i * HOP + FFT] += WINDOW * WINDOW
    audio /= np.maximum(weight, 1e-12)
    return audio[..., 3584:3584 + SEGMENT]

def infer_chunk(compiled, audio):
    z = spectrum(audio)
    x = np.stack([z.real, z.imag], axis=1).reshape(1, 4, 2048, FRAMES).astype(np.float32)
    xt = audio[None]
    mean, std = x.mean(), x.std(ddof=1)
    mt, st = xt.mean(), xt.std(ddof=1)
    result = compiled({'x': (x - mean) / (std + 1e-5), 'xt': (xt - mt) / (st + 1e-5)})
    freq = result[compiled.output(0)].reshape(4, 2, 2, 2048, FRAMES) * std + mean
    time = result[compiled.output(1)].reshape(4, 2, SEGMENT) * st + mt
    out = inverse_spectrum(freq[:, :, 0] + 1j * freq[:, :, 1]) + time
    if not np.isfinite(out).all():
        raise ValueError('NPU produced non-finite audio')
    return out

def read_audio(source, start, count):
    source.setpos(start)
    return np.frombuffer(source.readframes(count), dtype='<i2').reshape(-1, 2).T.astype(np.float32) / 32768

def normalization(source):
    total = total2 = 0.0
    count = source.getnframes()
    if not 0 < count <= RATE * 1800:
        raise ValueError('NPU preview accepts audio up to 30 minutes')
    for start in range(0, count, RATE * 10):
        ref = read_audio(source, start, min(RATE * 10, count - start)).mean(axis=0).astype(np.float64)
        total += ref.sum()
        total2 += np.dot(ref, ref)
    mean = total / count
    std = np.sqrt(max(0, (total2 - count * mean * mean) / max(1, count - 1)))
    return mean, max(float(std), 1e-5)

def separate_wave(source_path, output_dir, infer):
    """Stream through audio with a single segment of overlap accumulation."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with wave.open(str(source_path), 'rb') as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (2, 2, RATE):
            raise ValueError('Expected stereo 44.1 kHz PCM16')
        count = source.getnframes()
        mean, std = normalization(source)
        weight = np.concatenate([np.arange(1, SEGMENT // 2 + 1), np.arange(SEGMENT - SEGMENT // 2, 0, -1)]).astype(np.float32)
        weight /= weight.max()
        accum = np.zeros((2, 2, SEGMENT), dtype=np.float32)
        sums = np.zeros(SEGMENT, dtype=np.float32)
        with wave.open(str(output_dir / 'vocals.wav'), 'wb') as vocals, wave.open(str(output_dir / 'no_vocals.wav'), 'wb') as backing:
            for stream in (vocals, backing):
                stream.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
            for offset in range(0, count, STRIDE):
                size = min(SEGMENT, count - offset)
                left = (SEGMENT - size) // 2
                start, end = offset - left, offset - left + SEGMENT
                valid_start, valid_end = max(0, start), min(count, end)
                chunk = np.zeros((2, SEGMENT), dtype=np.float32)
                chunk[:, valid_start - start:valid_end - start] = (read_audio(source, valid_start, valid_end - valid_start) - mean) / std
                stems = infer(chunk)[..., left:left + size] * std + mean
                if stems.shape != (4, 2, size) or not np.isfinite(stems).all():
                    raise ValueError('Invalid NPU stems')
                tracks = np.stack([stems[3], stems[:3].sum(axis=0)])
                accum[..., :size] += tracks * weight[:size]
                sums[:size] += weight[:size]
                emit = min(STRIDE, count - offset)
                ready = accum[..., :emit] / sums[:emit]
                for stream, audio in zip((vocals, backing), ready):
                    stream.writeframes(np.rint(np.clip(audio, -1, 32767 / 32768) * 32768).astype('<i2').T.tobytes())
                accum[..., :-emit] = accum[..., emit:]
                accum[..., -emit:] = 0
                sums[:-emit] = sums[emit:]
                sums[-emit:] = 0
                print(f'{min(100, int((offset + emit) * 100 / count))}%| NPU', flush=True)

def load_model():
    import openvino as ov
    core = ov.Core()
    if 'NPU' not in core.available_devices:
        raise RuntimeError('NPU unavailable; check /dev/accel/accel0 mapping and Intel NPU driver')
    model = os.getenv('NPU_MODEL_PATH', '/opt/models/htdemucs_fwd.xml')
    cache = os.getenv('NPU_CACHE_DIR', '/data/npu-cache')
    Path(cache).mkdir(parents=True, exist_ok=True)
    compiled = core.compile_model(model, 'NPU', {'CACHE_DIR': cache})
    print('Execution device:', compiled.get_property('EXECUTION_DEVICES'), flush=True)
    return core, compiled

def main(source, output_dir):
    _, compiled = load_model()
    separate_wave(source, output_dir, lambda audio: infer_chunk(compiled, audio))

if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--probe']:
        import json
        core, compiled = load_model()
        # Qualification includes the actual selected model, not just enumeration.
        t = np.arange(SEGMENT, dtype=np.float32) / RATE
        audio = np.stack([np.sin(2 * np.pi * 220 * t), np.sin(2 * np.pi * 330 * t)]) * 0.2
        infer_chunk(compiled, audio)
        print(json.dumps(dict(ready=True, detection='ready', model='htdemucs',
            device=core.get_property('NPU', 'FULL_DEVICE_NAME'), backend='openvino-npu',
            message='Intel NPU 与 htdemucs 编译、试运行通过')), flush=True)
    else:
        main(sys.argv[1], sys.argv[2])
