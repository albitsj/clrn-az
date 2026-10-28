"""诊断不得影响响应或记录凭据，失败和有限历史也必须可见。"""

import json
from types import SimpleNamespace
import unittest
from network_selection import NetworkSelection

HOST = '67.hk.api.staging.laiwan.shafayouxi.com'


def sample(path, body=None, status=200, host=HOST):
    response = SimpleNamespace(status_code=status, json=lambda: body)
    return SimpleNamespace(request=SimpleNamespace(host=host, path=path, method='GET'), response=response)


class NetworkSelectionTests(unittest.TestCase):
    def test_metadata_and_health_only_copy_whitelisted_diagnostics(self):
        recorder = NetworkSelection()
        for servers in ([HOST, 'external.test'], {HOST: 'secret-address', 'external.test': 'secret'}):
            request = sample('/public/v13/metadata/servers?token=secret', {'ok': True, 'result': {'servers': servers}})
            recorder.observe(request)
            self.assertEqual(recorder.events[-1]['candidates'], [HOST])
        health = sample('/node/v1/status?token=secret', {'server_load': 'normal', 'backend_delay': 1065, 'token': 'secret'})
        original = health.response.json()
        recorder.observe(health)
        self.assertEqual(recorder.events[-1]['backend_delay'], 1065)
        self.assertEqual(health.response.json(), original)
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        health.response.json = lambda: {'server_load': 'secret', 'backend_delay': 'secret'}
        recorder.observe(health)
        self.assertNotIn('server_load', recorder.events[-1])
        self.assertNotIn('backend_delay', recorder.events[-1])

    def test_errors_connections_and_history_are_bounded_without_hiding_failure(self):
        recorder = NetworkSelection()
        request = sample('/node/v1/status', status=503)
        recorder.observe(request)
        self.assertEqual(recorder.events[-1]['status'], 503)
        request.response = None
        for _ in range(201):
            recorder.observe(request, 'error')
        self.assertEqual(len(recorder.events), 200)
        self.assertEqual(recorder.snapshot()['total'], 202)
        self.assertEqual(recorder.events[-1]['event'], 'error')
        recorder.observe(sample('/v2/centrifugo/connection/websocket?token=secret', status=101), 'websocket-connected')
        self.assertEqual(recorder.events[-1]['host'], HOST)
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        for path, host in (('/v10/profile/users', HOST), ('/node/v1/status', 'external.test')):
            recorder.observe(sample(path, host=host))
        self.assertEqual(recorder.total, 203)


if __name__ == '__main__':
    unittest.main()
