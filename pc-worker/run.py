"""Local Windows launcher. No cloud key is needed for PC inference."""
import json
import os
from pathlib import Path
import secrets
import socket
import sys

root = Path(__file__).resolve().parent
config_file = root / 'worker.json'
if not config_file.exists():
    config_file.write_text(json.dumps({'port': 8000, 'key': secrets.token_urlsafe(32), 'device': 'auto'}, indent=2), encoding='utf-8')
config = json.loads(config_file.read_text(encoding='utf-8'))
import torch
import imageio_ffmpeg
import uvicorn

os.environ['SEPARATION_API_KEY'] = config['key']
os.environ['SEPARATION_DATA_DIR'] = str(root / 'data')
os.environ['TORCH_HOME'] = str(root / 'data' / 'models')
device = 'cuda' if config.get('device', 'auto') == 'auto' and torch.cuda.is_available() else config.get('device', 'cpu')
if device == 'auto':
    device = 'cpu'
os.environ['SEPARATION_DEVICE'] = device
os.environ['FFMPEG'] = imageio_ffmpeg.get_ffmpeg_exe()
sys.path.insert(0, str(root))
print('\n=== Haohaochang PC audio worker ===')
print('Device:', torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU (check NVIDIA driver if GPU was expected)')
for address in sorted(set(socket.gethostbyname_ex(socket.gethostname())[2])):
    print(f'NAS PC URL: http://{address}:{config["port"]}')
print('Model: htdemucs')
print('PC connection key:', config['key'])
print('Keep this window open. Allow private-network access if Windows Firewall asks.')
print('First separation downloads the model. Close this window to stop.\n')
uvicorn.run('app:app', host='0.0.0.0', port=int(config['port']))
