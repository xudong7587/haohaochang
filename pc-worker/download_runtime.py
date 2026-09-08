"""Resume official PyTorch wheels in bounded chunks across interrupted installs."""
import concurrent.futures
import hashlib
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request


def main(version, runtime):
    if version not in ('2.5.1', '2.7.1') or runtime not in ('cpu', 'cu121', 'cu128'):
        raise ValueError('Unsupported runtime')
    folder = Path(__file__).resolve().parent / 'runtime' / 'wheels'
    folder.mkdir(parents=True, exist_ok=True)
    name = f'torch-{version}+{runtime}-cp311-cp311-win_amd64.whl'
    url = f'https://download.pytorch.org/whl/{runtime}/' + urllib.parse.quote(name)
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as response:
        size = int(response.headers['Content-Length'])
        expected = response.headers.get('x-amz-meta-checksum-sha256')
    output = folder / name
    if output.exists() and output.stat().st_size == size:
        with output.open('rb') as stream:
            if not expected or hashlib.file_digest(stream, 'sha256').hexdigest() == expected:
                return
    block = 32 * 1024 * 1024
    parts = folder / (name + '.parts')
    parts.mkdir(exist_ok=True)
    count = (size + block - 1) // block

    def fetch(index):
        start, end = index * block, min(size, (index + 1) * block) - 1
        target = parts / str(index)
        if target.exists() and target.stat().st_size == end - start + 1:
            return
        for attempt in range(6):
            try:
                request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                        raise RuntimeError('Invalid range response')
                    data = response.read(end - start + 2)
                if len(data) != end - start + 1:
                    raise RuntimeError('Incomplete download')
                target.write_bytes(data)
                return
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(2)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        pending = [pool.submit(fetch, index) for index in range(count)]
        for number, task in enumerate(concurrent.futures.as_completed(pending), 1):
            task.result()
            if number % 10 == 0 or number == count:
                print(f'Runtime download: {number}/{count} parts', flush=True)
    temporary = output.with_suffix('.tmp')
    digest = hashlib.sha256()
    with temporary.open('wb') as target:
        for index in range(count):
            data = (parts / str(index)).read_bytes()
            digest.update(data)
            target.write(data)
    if expected and digest.hexdigest() != expected:
        # Corrupt parts cannot be reused on retry.
        for index in range(count):
            (parts / str(index)).unlink(missing_ok=True)
        raise RuntimeError('Runtime checksum mismatch. Retry installation.')
    temporary.replace(output)
    for index in range(count):
        (parts / str(index)).unlink(missing_ok=True)
    print('Runtime download verified.', flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
