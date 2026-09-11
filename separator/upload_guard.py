"""Limit simultaneous multipart parsers before FastAPI spools uploaded files."""
import threading
from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException


class UploadGuard:
    def __init__(self, app, concurrency=2, max_bytes=101 * 1024 * 1024):
        self.app = app
        self.slots = threading.BoundedSemaphore(concurrency)
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('method') != 'POST' or scope.get('path') not in ('/separate', '/clip'):
            return await self.app(scope, receive, send)
        if not self.slots.acquire(blocking=False):
            return await JSONResponse({'detail':'Too many uploads'}, status_code=429,
                headers={'Retry-After':'3'})(scope, receive, send)
        total = 0
        max_bytes = 4097 * 1024 * 1024 if scope['path'] == '/clip' else self.max_bytes
        async def limited_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > max_bytes:
                raise HTTPException(413, 'Audio exceeds upload limit')
            return message
        try:
            length = dict(scope.get('headers', [])).get(b'content-length', b'0')
            try:
                too_large = int(length) > max_bytes
            except ValueError:
                too_large = True
            if too_large:
                return await JSONResponse({'detail':'Audio exceeds upload limit'}, status_code=413)(scope, receive, send)
            await self.app(scope, limited_receive, send)
        finally:
            self.slots.release()
