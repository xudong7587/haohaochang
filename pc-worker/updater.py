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
import uuid
import zipfile
from version import VERSION

from update_source import (API, ASSET, REPO, INDEX_URL, open_url, allowed_url,
                           version, release_asset, fetch_release, check_failure, CHECK_INTERVAL)


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
    def __init__(self, root, jobs, config, stop, transport=open_url, clock=time.time):
        self.root, self.jobs, self.config, self.stop = Path(root).resolve(), jobs, config, stop
        self.transport = transport
        self.clock = clock
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
            if self.clock() < self.state.get('nextCheck', 0):
                return self.snapshot()
            self.release = None
            self.set_state(phase='checking', error='')
        try:
            release, notes = fetch_release(self.transport)
            latest = release['version']
            with self.lock:
                self.release = release
                now = self.clock()
                self.set_state(phase='available' if version(latest) > version(VERSION) else 'current',
                               latest=latest, notes=notes, error='', checkedAt=now, nextCheck=now + CHECK_INTERVAL)
        except Exception as error:
            now = self.clock()
            message, retry_at = check_failure(error, now)
            self.set_state(phase='failed', error=message, checkedAt=now, nextCheck=retry_at)
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
            self.set_state(phase='cancelled' if isinstance(error, InterruptedError) else 'failed', error=str(error)[:400], nextCheck=0)
