"""Durable job state and atomic upload reservations for the single worker process."""
import json
import threading
import time
import uuid


class JobStore:
    def __init__(self, root):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def state(self, job):
        # Windows cannot replace a file while another thread has it open.
        # Dashboard polling must share the writers' lock, including closing the file.
        with self.lock:
            try:
                return json.loads((self.root / job / 'state.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                return dict(id=job, status='failed', error='Job state is missing or corrupt; retry from NAS')

    def write(self, job, value):
        with self.lock:
            target = self.root / job / 'state.json'
            temp = target.with_name('state-' + uuid.uuid4().hex + '.tmp')
            temp.write_text(json.dumps(dict(id=job, **value)), encoding='utf-8')
            temp.replace(target)

    def recover(self):
        for folder in self.root.iterdir():
            if folder.is_dir() and self.state(folder.name).get('status') in ('uploading', 'queued', 'running'):
                self.write(folder.name, dict(status='failed', stage='interrupted', retryable=True,
                                             error='Service restarted; retry from NAS'))
                (folder / 'input.part').unlink(missing_ok=True)

    def pending(self):
        with self.lock:
            return sum(self.state(f.name).get('status') in ('uploading', 'queued', 'running')
                       for f in self.root.iterdir() if f.is_dir())

    def reserve(self, model, title, request_key='', capacity=10):
        with self.lock:
            if request_key:
                for info in self.root.glob('*/info.json'):
                    try:
                        record = json.loads(info.read_text(encoding='utf-8'))
                    except (OSError, ValueError):
                        continue
                    if record.get('request_key') == request_key:
                        if record.get('model') != model:
                            raise ValueError('Idempotency key already belongs to another model')
                        return info.parent.name, False
            if self.pending() >= capacity:
                raise OverflowError('Queue full')
            job = uuid.uuid4().hex
            folder = self.root / job
            folder.mkdir()
            (folder / 'info.json').write_text(json.dumps(dict(title=title[:240], model=model,
                created=time.time(), request_key=request_key)), encoding='utf-8')
            self.write(job, dict(status='uploading', stage='uploading'))
            return job, True
