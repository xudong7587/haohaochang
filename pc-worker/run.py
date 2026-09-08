"""Local Windows launcher. No cloud key is needed for PC inference."""
import json
import os
from pathlib import Path
import secrets
import sys

root = Path(__file__).resolve().parent
config_file = root / 'worker.json'
if not config_file.exists():
    config_file.write_text(json.dumps({'port': 8000, 'key': secrets.token_urlsafe(32), 'device': 'auto', 'host': '127.0.0.1'}, indent=2), encoding='utf-8')
config = json.loads(config_file.read_text(encoding='utf-8'))
# Reopening the shortcut reuses the running local service.
import urllib.request
try:
    request = urllib.request.Request(f'http://127.0.0.1:{config["port"]}/health', headers={'Authorization': 'Bearer ' + config['key']})
    with urllib.request.urlopen(request, timeout=1) as response:
        existing = json.load(response)
    if existing.get('protocol') == 'ktv-separation-v1':
        if os.environ.get('RESOURCE_AI_OPEN_UI', '1') == '1':
            import webbrowser
            webbrowser.open(f'http://127.0.0.1:{config["port"]}/ui#{config["key"]}')
        print('Resource AI organizer is already running.')
        sys.exit(0)
except (OSError, ValueError):
    pass
from hardware import detect
plan = detect()
if plan.get('gpu_index') is not None:
    os.environ['CUDA_VISIBLE_DEVICES'] = str(plan['gpu_index'])
import torch
import imageio_ffmpeg
import uvicorn

os.environ['SEPARATION_API_KEY'] = config['key']
os.environ['SEPARATION_DATA_DIR'] = str(root / 'data')
os.environ['TORCH_HOME'] = str(root / 'data' / 'models')
device = 'cpu'
reason = plan['reason']
if config.get('device', 'auto') != 'cpu' and plan['device'] == 'cuda':
    try:
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable')
        probe = torch.ones(16, device='cuda')
        (probe * 2).sum().item()
        torch.cuda.synchronize()
        device = 'cuda'
    except Exception as error:
        reason = 'CUDA check failed; using CPU: ' + str(error)
os.environ['SEPARATION_SEGMENT'] = str(plan['segment'] if device == 'cuda' else 4)
os.environ['SEPARATION_DEVICE'] = device
os.environ['FFMPEG'] = imageio_ffmpeg.get_ffmpeg_exe()
sys.path.insert(0, str(root))
print('\n=== 好好唱资源 AI 整理器 ===')
print('Device:', torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU (check NVIDIA driver if GPU was expected)')
host = config.get('host', '127.0.0.1')
print('Reason:', reason)
print(f'Listen: http://{host}:{config["port"]}')
print('Loopback-only mode.' if host == '127.0.0.1' else 'Use a PC address reachable from NAS.')
print('Model: htdemucs')
print('PC connection key:', config['key'])
print('Keep this window open. Configuration: worker.json')
print('First separation downloads the model. Close this window to stop.\n')
import app as worker_app
from desktop import register
register(worker_app.app, root, config, plan, device)
ui_url = f'http://127.0.0.1:{config["port"]}/ui#{config["key"]}'
if os.environ.get('RESOURCE_AI_OPEN_UI', '1') == '1':
    import threading
    import webbrowser
    threading.Timer(2, lambda: webbrowser.open(ui_url)).start()
uvicorn.run(worker_app.app, host=host, port=int(config['port']))
