"""Pinned Intel OpenVINO model; downloaded at image build, never per request."""
import hashlib
from pathlib import Path
import urllib.request

REVISION = 'efb3d2bc54f93899b13b72b12c57001e19f09ae2'
FILES = {
    'htdemucs_fwd.xml': '1557f96f11cf1667beca60679926bf43b393d3ff71eb4b9a625c6a07bc23f4a4',
    'htdemucs_fwd.bin': '74c4e1ebd68b648ea5a2aabefb65d5c3ba805658037fc97a37b84ce9c72f4eb1',
}

def download(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, digest in FILES.items():
        target = folder / name
        partial = target.with_suffix(target.suffix + '.part')
        url = f'https://huggingface.co/Intel/demucs-openvino/resolve/{REVISION}/htdemucs_v4/{name}'
        checksum = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as stream:
            while data := response.read(1024 * 1024):
                checksum.update(data)
                stream.write(data)
        if checksum.hexdigest() != digest:
            partial.unlink(missing_ok=True)
            raise ValueError(f'Model checksum mismatch: {name}')
        partial.replace(target)

if __name__ == '__main__':
    import sys
    download(sys.argv[1])
