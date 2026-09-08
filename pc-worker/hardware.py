"""Choose a Windows runtime before downloading PyTorch. No network discovery."""
import csv
import json
import subprocess


def select_runtime(gpus):
    supported = []
    for gpu in gpus:
        try:
            memory = int(gpu['memory'])
            driver = int(gpu['driver'].split('.')[0])
            capability = float(gpu['capability'])
            if memory < 4096 or capability < 5.0:
                continue
            runtime = 'cu128' if capability >= 10 else 'cu121'
            if driver < (570 if runtime == 'cu128' else 531):
                continue
            supported.append((memory, gpu, runtime))
        except (ValueError, KeyError):
            continue
    if not supported:
        return dict(runtime='cpu', torch='2.5.1', device='cpu', model='htdemucs',
                    segment=4, reason='No compatible NVIDIA GPU/driver with at least 4 GB VRAM; using CPU. AMD/Intel GPU acceleration is not included.')
    memory, gpu, runtime = max(supported, key=lambda item: item[0])
    return dict(runtime=runtime, torch='2.7.1' if runtime == 'cu128' else '2.5.1',
                device='cuda', gpu_index=gpu['index'], gpu_name=gpu['name'],
                memory_mb=memory, model='htdemucs', segment=4 if memory < 8192 else 7,
                reason='Compatible NVIDIA GPU detected; actual CUDA execution is checked at startup.')


def detect():
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=index,name,memory.total,driver_version,compute_cap',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True,
                                timeout=15, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        fields = ['index', 'name', 'memory', 'driver', 'capability']
        return select_runtime([dict(zip(fields, [v.strip() for v in row])) for row in csv.reader(result.stdout.splitlines())])
    except (OSError, subprocess.SubprocessError):
        return select_runtime([])


if __name__ == '__main__':
    print(json.dumps(detect()))
