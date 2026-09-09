"""Build public bundles from explicit files; never include local credentials or models."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
release = root / 'release'
release.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
guide = (root / 'docs/USER-GUIDE.md').read_text(encoding='utf-8')
for document in ['VALIDATION.md', 'DEVELOPMENT.md', 'PROJECT-STATUS.md']:
    guide = guide.replace('(' + document + ')', '(https://github.com/xudong7587/haohaochang/blob/main/docs/' + document + ')')
guide = guide.replace('(../pc-worker/README.md)', '(https://github.com/xudong7587/haohaochang/blob/main/pc-worker/README.md)')

bundles = {
    'haohaochang-nas.zip': ['docker-compose.yaml', 'docker-compose.lan.yaml', 'docker-compose.ai.yaml', f'release/haohaochang-tv-{version}-debug.apk', 'release/实机测试说明.md'],
    'haohaochang-resource-ai.zip': ['pc-worker/open.vbs', 'pc-worker/open.ps1', 'pc-worker/start.cmd', 'pc-worker/start.ps1', 'pc-worker/run.py', 'pc-worker/hardware.py',
        'pc-worker/download_runtime.py', 'pc-worker/desktop.py', 'pc-worker/lan.py', 'pc-worker/README.md', 'separator/app.py', 'separator/clipping.py', 'separator/job_store.py', 'separator/inference.py', 'separator/upload_guard.py', 'separator/requirements.txt',
        'pc-worker/ui/index.html', 'pc-worker/ui/icon.svg', 'pc-worker/ui/icon.png', 'pc-worker/ui/icon.ico'],
}
for name, files in bundles.items():
    with ZipFile(release / name, 'w', ZIP_DEFLATED) as archive:
        for source in files:
            relative = source.removeprefix('pc-worker/') if source.startswith('pc-worker/ui/') else Path(source).name
            archive.write(root / source, relative)
        archive.writestr('四端使用说明.md', guide)
    with ZipFile(release / name) as archive:
        assert archive.testzip() is None
        assert not any('worker.json' in item or 'settings.json' in item or '.venv' in item for item in archive.namelist())
    print(name, (release / name).stat().st_size)

# Standalone Windows rename tool uses the same layout as the installed NAS share.
with ZipFile(release / 'haohaochang-preprocess.zip', 'w', ZIP_DEFLATED) as archive:
    for source, target in [
        ('启动重命名.cmd', '好好唱重命名.cmd'),
        ('重命名.ps1', 'RenameTool/app.ps1'),
        ('core.ps1', 'RenameTool/core.ps1'),
        ('使用说明.txt', 'RenameTool/使用说明.txt'),
    ]:
        archive.write(root / 'tools/bili-preprocess' / source, target)
with ZipFile(release / 'haohaochang-preprocess.zip') as archive:
    assert archive.testzip() is None
print('haohaochang-preprocess.zip', (release / 'haohaochang-preprocess.zip').stat().st_size)
