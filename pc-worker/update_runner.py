"""Copied outside the program before shutdown. Keeps a journal and old files."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import psutil


def save(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value), encoding='utf-8')
    for attempt in range(20):
        try:
            temp.replace(path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def rollback(root, folder):
    journal = json.loads((folder / 'journal.json').read_text(encoding='utf-8'))
    for item in reversed(journal):
        target = root / item['name']
        if item['existed']:
            shutil.copyfile(folder / 'backup' / item['name'], target)
        else:
            target.unlink(missing_ok=True)


def apply(root, folder, names):
    journal = []
    for name in names:
        target = root / name
        # Resolve again on the installer side; also reject local directory junctions.
        if not target.resolve().is_relative_to(root.resolve()):
            raise ValueError('安装路径越界')
        existed = target.exists()
        if existed:
            backup = folder / 'backup' / name
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(target, backup)
        journal.append(dict(name=name, existed=existed))
        save(folder / 'journal.json', journal)
        target.parent.mkdir(parents=True, exist_ok=True)
        (folder / 'new' / name).replace(target)


def launch(root, folder):
    env = dict(os.environ, RESOURCE_AI_SHOW_WINDOW='0')
    with (folder / 'restart.log').open('ab') as log:
        return subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(root / 'start.ps1')],
                                cwd=root, env=env, stdout=log, stderr=log,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def run(folder, startup_timeout=180, poll_interval=2):
    folder = folder.resolve()
    plan = json.loads((folder / 'plan.json').read_text(encoding='utf-8'))
    root = Path(plan['root']).resolve()
    if not folder.is_relative_to(root / 'data' / 'updates'):
        raise ValueError('Invalid staging directory')
    status = folder.parent / 'status.json'
    child = None
    applied = False
    try:
        try:
            parent = psutil.Process(plan['pid'])
            if abs(parent.create_time() - plan['created']) < 0.01:
                parent.wait(timeout=90)
        except psutil.NoSuchProcess:
            pass
        applied = True
        apply(root, folder, plan['files'])
        config = json.loads((root / 'worker.json').read_text(encoding='utf-8'))
        save(status, dict(phase='restarting', latest=plan['version']))
        child = launch(root, folder)
        deadline = time.monotonic() + startup_timeout
        while time.monotonic() < deadline:
            try:
                req = urllib.request.Request(f'http://127.0.0.1:{int(config["port"])}/desktop/status',
                                             headers={'Authorization': 'Bearer ' + config['key']})
                with urllib.request.urlopen(req, timeout=3) as response:
                    data = json.load(response)
                if data.get('version') == plan['version']:
                    save(status, dict(phase='complete', latest=plan['version']))
                    return
            except (OSError, ValueError):
                pass
            time.sleep(poll_interval)
        raise RuntimeError('新版启动超时，已恢复旧程序')
    except Exception as error:
        if child and child.poll() is None:
            try:
                descendants = psutil.Process(child.pid).children(recursive=True)
                for proc in reversed(descendants):
                    proc.terminate()
                psutil.wait_procs(descendants, timeout=10)
                for proc in descendants:
                    if proc.is_running():
                        proc.kill()
                child.terminate()
                child.wait(timeout=10)
            except psutil.NoSuchProcess:
                pass
        if applied and (folder / 'journal.json').exists():
            try:
                rollback(root, folder)
            except OSError as recovery_error:
                save(status, dict(phase='failed', error='恢复旧程序失败，请从 data/updates 中的备份手动恢复：' + str(recovery_error)[:200]))
                return
        save(status, dict(phase='failed', error=str(error)[:400]))
        if applied:
            launch(root, folder)


if __name__ == '__main__':
    run(Path(sys.argv[1]))
