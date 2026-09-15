"""Only a definite 404 permits publication; network/auth failures never allow overwrite."""
import json
import os
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

image = os.environ['IMAGE']
tag = os.environ['TAG']
assert image in ('ghcr.io/xudong7587/haohaochang-separator', 'ghcr.io/xudong7587/haohaochang-separator-npu')
assert re.fullmatch(r'runtime-\d+\.\d+\.\d+', tag)
repository = image.removeprefix('ghcr.io/')
with urlopen('https://ghcr.io/token?scope=repository:' + repository + ':pull', timeout=30) as response:
    token = json.load(response)['token']
request = Request('https://ghcr.io/v2/' + repository + '/manifests/' + tag,
    headers={'Authorization': 'Bearer ' + token,
             'Accept': 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json'})
try:
    with urlopen(request, timeout=30):
        raise SystemExit('Runtime tag already exists; choose a new version')
except HTTPError as error:
    if error.code != 404:
        raise
print('New runtime tag verified: ' + image + ':' + tag)
