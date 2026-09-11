"""Read immutable PC update metadata without depending on GitHub REST quota."""
import json
import math
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from email.utils import parsedate_to_datetime

REPO = 'xudong7587/haohaochang'
API = 'https://api.github.com/repos/' + REPO + '/releases/latest'
INDEX_NAME = 'haohaochang-pc-update.json'
INDEX_URL = 'https://github.com/' + REPO + '/releases/latest/download/' + INDEX_NAME
DOWNLOAD_PAGE = 'https://github.com/' + REPO + '/releases/latest'
ASSET = 'haohaochang-resource-ai.zip'
CHECK_INTERVAL = 300


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
    try:
        u = urlsplit(url)
        return (u.scheme == 'https' and not u.username and not u.password and u.port in (None, 443)
                and ((u.hostname == 'github.com' and u.path.startswith('/' + REPO + '/releases/download/'))
                     or (not initial and u.hostname in ('release-assets.githubusercontent.com', 'objects.githubusercontent.com'))))
    except ValueError:
        return False


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError('更新下载地址无效')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url):
    if url not in (API, INDEX_URL) and not allowed_url(url, True):
        raise ValueError('更新下载地址无效')
    metadata = url in (API, INDEX_URL)
    return urllib.request.build_opener(Redirects()).open(
        urllib.request.Request(url, headers={'User-Agent': 'haohaochang-updater',
                                            'Accept': 'application/json' if metadata else 'application/octet-stream'}),
        timeout=10 if metadata else 30)


def read_json(transport, url, limit):
    with transport(url) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('更新信息过大')
    data = json.loads(data)
    if not isinstance(data, dict):
        raise ValueError('更新信息格式无效')
    return data


def checked_asset(latest, tag, name, url, digest, size):
    version(latest)
    expected = f'https://github.com/{REPO}/releases/download/{tag}/{name}'
    if name not in (f'haohaochang-resource-ai-v{latest}.zip', ASSET) or url != expected or not allowed_url(url, True):
        raise ValueError('更新包地址与版本不匹配')
    if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) or type(size) is not int or not 0 < size <= 32 * 1024 * 1024:
        raise ValueError('更新包缺少有效的大小或 SHA-256 校验')
    return dict(version=latest, url=url, digest=digest, size=size)


def fetch_release(transport):
    try:
        data = read_json(transport, INDEX_URL, 64 * 1024)
    except (urllib.error.URLError, TimeoutError, OSError):
        # Older releases lack the index. A download-channel outage may also
        # leave the API reachable. Never fall back after malformed metadata.
        data = read_json(transport, API, 2 * 1024 * 1024)
        tag = str(data.get('tag_name', ''))
        latest = tag.lstrip('v')
        version(tag)
        if data.get('draft') or data.get('prerelease'):
            raise ValueError('不是正式版本')
        asset = release_asset(data.get('assets', []), latest)
        if not asset:
            raise ValueError('此版本没有可用的 PC 更新包')
        digest = asset.get('digest', '')
        if not isinstance(digest, str) or not digest.startswith('sha256:'):
            raise ValueError('更新包缺少有效的 SHA-256 校验')
        release = checked_asset(latest, tag, asset.get('name'), asset.get('browser_download_url'), digest[7:], asset.get('size'))
        return release, str(data.get('body') or '')[:3000]
    if data.get('schema') != 1 or not isinstance(data.get('pc'), dict):
        raise ValueError('更新信息格式无效')
    latest = str(data.get('version', ''))
    version(latest)
    if latest.startswith('v'):
        raise ValueError('更新信息版本格式无效')
    asset = data['pc']
    release = checked_asset(latest, 'v' + latest, f'haohaochang-resource-ai-v{latest}.zip', asset.get('url'), asset.get('sha256'), asset.get('size'))
    return release, str(data.get('notes') or '')[:3000]


def check_failure(error, now):
    retry_at = now + 60
    if isinstance(error, urllib.error.HTTPError) and error.code in (403, 429):
        headers = error.headers or {}
        try:
            reset = float(headers.get('X-RateLimit-Reset', 0))
            if math.isfinite(reset):
                retry_at = max(retry_at, reset)
        except (ValueError, TypeError):
            pass
        after = headers.get('Retry-After', '')
        try:
            seconds = float(after)
            if math.isfinite(seconds):
                retry_at = max(retry_at, now + seconds)
        except (ValueError, TypeError):
            try:
                retry_at = max(retry_at, parsedate_to_datetime(after).timestamp())
            except (ValueError, TypeError, AttributeError, OverflowError):
                pass
        try:
            when = time.strftime('%H:%M', time.localtime(retry_at))
        except (OverflowError, OSError, ValueError):
            when = '服务器允许的时间'
        return f'GitHub 暂时限制更新请求，请在 {when} 后重试，或点击“手动下载更新包”。', retry_at
    if isinstance(error, (urllib.error.URLError, TimeoutError, OSError)):
        return '连接更新服务失败，请稍后重试，或点击“手动下载更新包”。', retry_at
    return str(error)[:300], retry_at
