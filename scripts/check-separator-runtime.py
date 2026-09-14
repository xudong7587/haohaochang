"""Exercise native ML/audio libraries in the published CPU image, without model downloads."""
import platform
import tempfile
from pathlib import Path

import torch
import torchaudio
from demucs.demucs import Demucs
from demucs.htdemucs import HTDemucs

torch.set_num_threads(2)
audio = torch.sin(torch.arange(4410) * (2 * torch.pi * 440 / 44100)).repeat(2, 1)
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "tone.wav"
    torchaudio.save(str(path), audio, 44100)
    decoded, rate = torchaudio.load(str(path))
    assert rate == 44100 and decoded.shape == audio.shape
    assert torch.isfinite(decoded).all()

with torch.no_grad():
    spectrum = torch.stft(audio, n_fft=512, window=torch.hann_window(512), return_complex=True)
    assert torch.isfinite(spectrum).all()
    model = Demucs(sources=["vocals", "other"], channels=8, depth=2, resample=False)
    separated = model(audio.unsqueeze(0))
    assert separated.shape == (1, 2, 2, 4410)
    assert torch.isfinite(separated).all()
print(f"Native separator smoke passed: {platform.machine()}, torch={torch.__version__}, torchaudio={torchaudio.__version__}")
