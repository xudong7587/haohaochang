"""Docker-only prerelease bundle: never emits TV/PC packages or update manifests."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
assert re.fullmatch(r'\d+\.\d+\.\d+\.rc\d+', version), 'Only explicit RC versions are allowed'
release = root / 'release'
release.mkdir(exist_ok=True)
target = release / f'haohaochang-nas-npu-v{version}.zip'
files = ['docker-compose.npu-rc1.yaml', 'docker-compose.npu-rc1.lan.yaml',
    'README.md', 'CHANGELOG.md', 'docs/NPU-RC1.md', 'docs/USER-GUIDE.md',
    f'release/RELEASE-NOTES-v{version}.md']
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in files: archive.write(root / name, name)
with ZipFile(target) as archive: assert archive.testzip() is None
digest = hashlib.sha256(target.read_bytes()).hexdigest()
(release / f'SHA256SUMS-v{version}.txt').write_text(f'{digest}  {target.name}\n', encoding='utf-8')
print(target.name, target.stat().st_size, digest)
