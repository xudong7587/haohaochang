"""Build public bundles from explicit files; never include local credentials or models."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
release = root / 'release'
release.mkdir(exist_ok=True)
guide = (root / 'docs/USER-GUIDE.md').read_text(encoding='utf-8')
for document in ['VALIDATION.md', 'DEVELOPMENT.md', 'PROJECT-STATUS.md']:
    guide = guide.replace('(' + document + ')', '(https://github.com/xudong7587/haohaochang/blob/main/docs/' + document + ')')
guide = guide.replace('(../pc-worker/README.md)', '(https://github.com/xudong7587/haohaochang/blob/main/pc-worker/README.md)')

bundles = {
    'haohaochang-nas.zip': ['docker-compose.yaml', 'docker-compose.lan.yaml', 'docker-compose.ai.yaml', 'release/haohaochang-tv-0.3.0-debug.apk', 'release/实机测试说明.md'],
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
