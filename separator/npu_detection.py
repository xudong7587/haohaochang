"""Nonblocking device/model qualification; no host driver installation."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

class NpuDetection:
    def __init__(self):
        self.lock = threading.Lock()
        self.result = dict(ready=False, detection='detecting', message='正在检测 NPU 并匹配 htdemucs 模型')
        self.active = False
        self.checked = 0

    def snapshot(self):
        with self.lock:
            if not self.active and not self.result['ready'] and time.monotonic() - self.checked > 60:
                self.active = True
                threading.Thread(target=self.detect, daemon=True).start()
            return dict(self.result)

    def detect(self):
        try:
            run = subprocess.run([sys.executable, str(Path(__file__).with_name('npu_inference.py')), '--probe'],
                capture_output=True, text=True, timeout=240, check=True)
            result = json.loads(run.stdout.strip().splitlines()[-1])
            if result.get('ready') is not True:
                raise ValueError('Model qualification did not succeed')
        except Exception as error:
            detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
            result = dict(ready=False, detection='unavailable',
                message='NPU 或模型未通过检测；请检查 Intel NPU 驱动与设备映射。AMD/高通 NPU 尚未适配。',
                detail=str(detail)[-1200:])
        with self.lock:
            self.result = result
            self.checked = time.monotonic()
            self.active = False
