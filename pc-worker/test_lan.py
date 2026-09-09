"""Discovery tests simulate UDP in memory; never probe the local network."""
import json
import threading
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from lan import private_ip, register


class LanTests(unittest.TestCase):
    def test_private_ranges_exclude_loopback_public_and_invalid(self):
        for ip in ('10.0.0.1','172.16.0.2','192.168.1.8'):
            self.assertTrue(private_ip(ip))
        for ip in ('127.0.0.1','8.8.8.8','172.32.0.1','192.168.1.999','::1'):
            self.assertFalse(private_ip(ip))

    def test_pair_requires_one_use_challenge_bound_to_discovery_sender(self):
        ready=threading.Event()
        replies=[]
        class Socket:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def bind(self,address): pass
            def settimeout(self,timeout): pass
            def recvfrom(self,size):
                if replies: raise OSError('test listener complete')
                return json.dumps(dict(protocol='haohaochang-lan-v1',nonce='valid-nonce-123456')).encode(), ('192.168.1.10',43212)
            def sendto(self,data,target):
                replies.append(json.loads(data)); ready.set()
        app=FastAPI()
        register(app,dict(id='test-worker-123',key='test-private-key-1234',port=8000,lan=True),socket_factory=lambda *args:Socket())
        with TestClient(app,client=('192.168.1.10',43212)) as client:
            self.assertTrue(ready.wait(2))
            self.assertNotIn('key',replies[0])
            self.assertEqual(client.post('/lan/pair',json={'challenge':'invalid'}).status_code,403)
            challenge=replies[0]['challenge']
            result=client.post('/lan/pair',json={'challenge':challenge})
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.json()['key'],'test-private-key-1234')
            self.assertEqual(client.post('/lan/pair',json={'challenge':challenge}).status_code,403)
        public=FastAPI(); register(public,dict(id='test-worker-123',key='private',port=8000,lan=False))
        with TestClient(public,client=('8.8.8.8',43212)) as client:
            self.assertEqual(client.post('/lan/pair',json={'challenge':'invalid'}).status_code,403)
