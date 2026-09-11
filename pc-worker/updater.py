"""Verified releases, a drained job queue, and a separate rollback installer."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlsplit
import uuid
import zipfile
from version import VERSION

REPO = 'xudong7587/haohaochang'
API = 'https://api.github.com/repos/' + REPO + '/releases/latest'
ASSET = 'haohaochang-resource-ai.zip'  # Older releases remain readable.


def version(value):
    if not re.fullmatch(r'v?\d+\.\d+\.\d+', str(value)):
        raise ValueError('版本号无效')
    return tuple(map(int, str(value).lstrip('v').split('.')))


def release_asset(assets, latest):
    version(latest)
    for name in (f'haohaochang-resource-ai-v{str(latest).lstrip("v")}.zip', ASSET):
        found = next((asset for asset in assets if asset.get('name') == name), None)
        if found:
            return found
    return None


def allowed_url(url, initial=False):
    u = urlsplit(url)
    return (u.scheme == 'https' and not u.username and not u.password and u.port in (None, 443)
            and ((u.hostname == 'github.com' and u.path.startswith('/' + REPO + '/releases/download/'))
                 or (not initial and u.hostname in ('release-assets.githubusercontent.com', 'objects.githubusercontent.com'))))


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError('更新下载地址无效')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url):
    return urllib.request.build_opener(Redirects()).open(
        urllib.request.Request(url, headers={'User-Agent': 'haohaochang-updater', 'Accept': 'application/vnd.github+json'}), timeout=30)


def safe_name(name):
    p = PurePosixPath(name)
    return (not p.is_absolute() and '\\' not in name and ':' not in name and
            all(part not in ('', '.', '..') and not part.endswith((' ', '.')) for part in name.split('/')) and
            ((len(p.parts) == 1 and p.suffix.lower() in ('.py', '.ps1', '.cmd', '.vbs', '.md', '.txt')) or
             (len(p.parts) == 2 and p.parts[0] == 'ui' and p.suffix.lower() in ('.html', '.svg', '.png', '.ico', '.css', '.js'))))


def unpack(archive, target, expected):
    """No writable configuration, runtime or model path is accepted from a release."""
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        names = [i.filename for i in entries]
        if len(names) > 200 or len(set(n.casefold() for n in names)) != len(names):
            raise ValueError('更新包包含重复文件或文件过多')
        if sum(i.file_size for i in entries) > 64 * 1024 * 1024:
            raise ValueError('更新包解压后过大')
        if any((i.external_attr >> 16) & 0o170000 == 0o120000 for i in entries):
            raise ValueError('更新包不能包含链接')
        manifest = json.loads(z.read('update-manifest.json'))
        files = manifest['files']
        if manifest['version'] != expected or set(names) != set(files) | {'update-manifest.json'}:
            raise ValueError('更新包清单不匹配')
        if not all(safe_name(n) for n in files) or not {'run.py', 'start.ps1', 'version.py', 'updater.py', 'update_runner.py'}.issubset(files):
            raise ValueError('更新包文件路径无效')
        for name, digest in files.items():
            data = z.read(name)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('更新文件校验失败')
            dest = target / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        return list(files)


class UpdateManager:
    def __init__(self, root, jobs, config, stop, transport=open_url):
        self.root, self.jobs, self.config, self.stop = Path(root).resolve(), jobs, config, stop
        self.transport = transport
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.release = None
        self.state_file = self.root / 'data' / 'updates' / 'status.json'
        self.state = {'phase': 'idle', 'current': VERSION}
        try:
            saved = json.loads(self.state_file.read_text(encoding='utf-8'))
            if saved.get('phase') in ('installing', 'restarting', 'complete', 'failed'):
                self.state.update(saved)
        except (OSError, ValueError):
            pass
        if self.state['phase'] in ('installing', 'restarting'):
            self.jobs.pause()

    def set_state(self, **values):
        with self.lock:
            self.state.update(values)
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            temp = self.state_file.with_suffix('.tmp')
            temp.write_text(json.dumps(self.state), encoding='utf-8')
            temp.replace(self.state_file)

    def snapshot(self):
        with self.lock:
            if self.state['phase'] in ('installing', 'restarting'):
                try:
                    saved = json.loads(self.state_file.read_text(encoding='utf-8'))
                    self.state.update(saved)
                    if saved['phase'] in ('complete', 'failed'):
                        self.jobs.resume()
                except (OSError, ValueError):
                    pass
            return dict(self.state, current=VERSION)

    def check(self):
        with self.lock:
            if self.state['phase'] in ('checking', 'downloading', 'waiting', 'installing', 'restarting'):
                return self.snapshot()
            self.set_state(phase='checking', error='')
        try:
            with self.transport(API) as response:
                data = json.loads(response.read(2 * 1024 * 1024))
            latest = str(data['tag_name']).lstrip('v')
            version(latest)
            if data.get('draft') or data.get('prerelease'):
                raise ValueError('不是正式版本')
            asset = release_asset(data['assets'], latest)
            if not asset or not allowed_url(asset['browser_download_url'], True):
                raise ValueError('此版本没有可用的 PC 更新包')
            digest = asset.get('digest', '')
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest) or not 0 < asset['size'] <= 32 * 1024 * 1024:
                raise ValueError('更新包缺少有效的 SHA-256 校验')
            self.release = dict(version=latest, url=asset['browser_download_url'], digest=digest[7:], size=asset['size'])
            self.set_state(phase='available' if version(latest) > version(VERSION) else 'current', latest=latest,
                           notes=str(data.get('body') or '')[:3000], error='')
        except Exception as error:
            self.set_state(phase='failed', error=str(error)[:400])
        return self.snapshot()

    def install(self, requested):
        with self.lock:
            if self.state['phase'] != 'available' or not self.release or requested != self.release['version']:
                raise ValueError('请先检查新版，再点击更新')
            if version(requested) <= version(VERSION):
                raise ValueError('不能降级')
            self.cancelled.clear()
            self.set_state(phase='downloading', progress=0, error='')
            threading.Thread(target=self.download, args=(dict(self.release),), daemon=True).start()
        return self.snapshot()

    def cancel(self):
        with self.lock:
            if self.state['phase'] not in ('downloading', 'waiting'):
                raise ValueError('安装已开始或当前没有可取消的更新')
            self.cancelled.set()
        return self.snapshot()

    def download(self, release):
        folder = self.state_file.parent / uuid.uuid4().hex
        try:
            if not folder.resolve().is_relative_to(self.root):
                raise ValueError('更新暂存目录必须位于整理器安装目录内')
            folder.mkdir(parents=True)
            archive = folder / 'release.zip'
            digest, total = hashlib.sha256(), 0
            with self.transport(release['url']) as source, archive.open('wb') as output:
                while True:
                    chunk = source.read(128 * 1024)
                    if not chunk:
                        break
                    if self.cancelled.is_set():
                        raise InterruptedError('已取消更新')
                    total += len(chunk)
                    if total > release['size']:
                        raise ValueError('更新包大小不匹配')
                    output.write(chunk)
                    digest.update(chunk)
                    self.set_state(progress=int(total * 100 / release['size']))
            if total != release['size'] or digest.hexdigest() != release['digest']:
                raise ValueError('更新包校验失败，原程序保持不变')
            names = unpack(archive, folder / 'new', release['version'])
            self.jobs.pause()
            self.set_state(phase='waiting', progress=100)
            while self.jobs.pending():
                if self.cancelled.wait(0.5):
                    raise InterruptedError('已取消更新')
            with self.lock:
                if self.cancelled.is_set():
                    raise InterruptedError('已取消更新')
                import psutil
                payload = dict(root=str(self.root), files=names, version=release['version'],
                               pid=os.getpid(), created=psutil.Process().create_time())
                (folder / 'plan.json').write_text(json.dumps(payload), encoding='utf-8')
                shutil.copyfile(self.root / 'update_runner.py', folder / 'runner.py')
                self.set_state(phase='installing')
                with (folder / 'installer.log').open('ab') as log:
                    subprocess.Popen([sys.executable, str(folder / 'runner.py'), str(folder)],
                                     cwd=folder, stdout=log, stderr=log, close_fds=True,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.stop()
        except Exception as error:
            self.jobs.resume()
            self.set_state(phase='cancelled' if isinstance(error, InterruptedError) else 'failed', error=str(error)[:400])
