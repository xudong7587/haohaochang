"""Local discovery: no secrets in broadcasts; one-use pairing bound to sender IP."""
import ipaddress
import json
import secrets
import socket
import threading
import time
from fastapi import Request, HTTPException


def private_ip(value):
    try:
        ip = ipaddress.IPv4Address(value)
        return any(ip in ipaddress.ip_network(net) for net in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
    except ValueError:
        return False


def addresses():
    import psutil
    return list(dict.fromkeys(a.address for rows in psutil.net_if_addrs().values() for a in rows
                             if a.family == socket.AF_INET and private_ip(a.address)))


def register(app, config, socket_factory=socket.socket):
    challenges = {}
    lock = threading.Lock()
    stop = threading.Event()
    state = {'enabled': config.get('lan', True), 'status': 'starting', 'last_paired': None}
    app.state.lan = state

    @app.post('/lan/pair')
    async def pair(request: Request):
        if not state['enabled'] or not private_ip(request.client.host):
            raise HTTPException(403, 'LAN pairing only')
        if int(request.headers.get('content-length', '0')) > 1024:
            raise HTTPException(413, 'Pair request too large')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 1024:
                raise HTTPException(413, 'Pair request too large')
        try:
            value = json.loads(raw)
            challenge = value.get('challenge', '')
            if not isinstance(challenge, str):
                raise ValueError()
        except (ValueError, AttributeError):
            raise HTTPException(400, 'Invalid pairing request')
        with lock:
            proof = challenges.pop(challenge, None)
        if not proof or proof[0] != request.client.host or proof[1] < time.monotonic():
            raise HTTPException(403, 'Discovery challenge expired')
        state['last_paired'] = request.client.host
        return dict(id=config['id'], key=config['key'])

    def listen():
        with socket_factory(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            try:
                sock.bind(('0.0.0.0', 43211))
                sock.settimeout(1)
                state['status'] = 'listening'
                while not stop.is_set():
                    try:
                        raw, sender = sock.recvfrom(2048)
                    except socket.timeout:
                        continue
                    if not private_ip(sender[0]):
                        continue
                    try:
                        value = json.loads(raw)
                        nonce = value.get('nonce', '')
                        if value.get('protocol') != 'haohaochang-lan-v1' or not isinstance(nonce, str) or not 16 <= len(nonce) <= 100:
                            continue
                    except (ValueError, AttributeError):
                        continue
                    now = time.monotonic()
                    with lock:
                        for key in list(challenges):
                            if challenges[key][1] < now:
                                del challenges[key]
                        if len(challenges) >= 128:
                            continue
                        challenge = secrets.token_urlsafe(32)
                        challenges[challenge] = (sender[0], now + 30)
                    sock.sendto(json.dumps(dict(protocol='haohaochang-lan-v1', nonce=nonce,
                        id=config['id'], name=socket.gethostname(), port=int(config['port']), challenge=challenge)).encode(), sender)
            except OSError as error:
                state.update(status='error', error=str(error))

    @app.on_event('startup')
    def startup():
        if state['enabled']:
            threading.Thread(target=listen, daemon=True, name='lan-discovery').start()

    @app.on_event('shutdown')
    def shutdown():
        stop.set()
