import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
import numpy as np
from npu_inference import SEGMENT, STRIDE, RATE, spectrum, inverse_spectrum, separate_wave
from npu_detection import NpuDetection

class AudioTests(unittest.TestCase):
    def test_spectrum_reconstruction_preserves_phase_and_length(self):
        t = np.arange(SEGMENT) / RATE
        audio = np.stack([np.sin(2*np.pi*220*t), np.cos(2*np.pi*730*t)]).astype(np.float32)*0.3
        actual = inverse_spectrum(spectrum(audio)[None])[0]
        self.assertEqual(actual.shape, audio.shape)
        # htdemucs drops two edge frames and restores them as zeros.
        # Interior phase/amplitude are preserved; the first cosine sample is halved.
        np.testing.assert_allclose(actual[:,2048:-2048], audio[:,2048:-2048], atol=0.0001)
        self.assertAlmostEqual(float(actual[1,0]), 0.15, places=5)

    def test_streaming_overlap_short_tail_silence_and_single_sample(self):
        for count in [1, 1000, STRIDE, SEGMENT + STRIDE + 117]:
            with self.subTest(count=count), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                t = np.arange(count) / RATE
                audio = np.stack([np.sin(2*np.pi*223*t)*0.1, np.cos(2*np.pi*117*t)*0.15], axis=1)
                if count == 1000: audio[:] = 0
                pcm = np.rint(audio*32768).astype('<i2')
                with wave.open(str(root/'source.wav'), 'wb') as source:
                    source.setparams((2,2,RATE,0,'NONE','not compressed'))
                    source.writeframes(pcm.tobytes())
                def identity(chunk):
                    return np.stack([np.zeros_like(chunk)]*3+[chunk])
                separate_wave(root/'source.wav', root/'out', identity)
                with wave.open(str(root/'out/vocals.wav'),'rb') as result:
                    self.assertEqual(result.getnframes(),count)
                    actual=np.frombuffer(result.readframes(count),dtype='<i2').reshape(-1,2)
                    self.assertLessEqual(np.abs(actual.astype(float)-pcm).max(),1)
                with wave.open(str(root/'out/no_vocals.wav'),'rb') as result:
                    self.assertEqual(result.getnframes(),count)

    def test_invalid_model_output_does_not_succeed(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            with wave.open(str(root/'source.wav'),'wb') as source:
                source.setparams((2,2,RATE,0,'NONE','not compressed'))
                source.writeframes(bytes(400))
            with self.assertRaisesRegex(ValueError,'Invalid NPU stems'):
                separate_wave(root/'source.wav',root/'out',lambda a: np.full((4,2,SEGMENT),np.nan))

    def test_auto_detection_requires_successful_model_qualification(self):
        detector=NpuDetection()
        with patch('npu_detection.subprocess.run',side_effect=RuntimeError('unsupported accelerator')):
            detector.detect()
        self.assertFalse(detector.result['ready'])
        self.assertEqual(detector.result['detection'],'unavailable')
        with patch('npu_detection.subprocess.run') as run:
            run.return_value.stdout=json.dumps(dict(ready=True,model='htdemucs',device='Intel AI Boost'))
            detector.detect()
        self.assertTrue(detector.result['ready'])
        self.assertEqual(detector.result['model'],'htdemucs')

if __name__ == '__main__': unittest.main()
