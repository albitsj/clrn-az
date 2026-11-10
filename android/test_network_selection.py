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
    def test_wallet_reads_record_contract_without_identity_balance_or_credentials(self):
        recorder = NetworkSelection()
        body = {'ok': True, 'result': {'currencies': [
            {'code': 'coin', 'balance': 'secret-balance'}, {'code': 'diamond', 'balance': 'secret-balance'},
            {'code': 'secret-currency', 'balance': 'secret-balance'}]}, 'token': 'secret-token'}
        flow = sample('/v10/wallet/secret-user?token=secret-token', body)
        flow.request.method = 'PUT'
        recorder.observe(flow)
        self.assertEqual(recorder.events[0]['path'], '/v10/wallet/{user}')
        self.assertEqual(recorder.events[0]['walletCodes'], ['coin', 'diamond'])
        self.assertTrue(recorder.events[0]['walletOk'])
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        self.assertEqual(flow.response.json(), body)
        flow.response = None
        recorder.observe(flow, 'error')
        self.assertEqual(recorder.events[-1]['event'], 'error')
        self.assertNotIn('status', recorder.events[-1])

    def test_wallet_diagnostics_keep_empty_or_failed_contract_and_ignore_writes(self):
        recorder = NetworkSelection()
        for body, codes in (({'ok': True, 'result': {'currencies': []}}, []), ({'ok': False}, None)):
            flow = sample('/v10/wallet/private-user', body, status=503)
            flow.request.method = 'PUT'
            recorder.observe(flow)
            self.assertEqual(recorder.events[-1]['status'], 503)
            self.assertEqual(recorder.events[-1]['walletCodes'], codes)
        for path, method in (('/v10/wallet/private-user', 'POST'), ('/v10/wallet/private-user/pay', 'PUT')):
            flow = sample(path, {})
            flow.request.method = method
            recorder.observe(flow)
        self.assertEqual(recorder.total, 2)

    def test_room_initialization_records_only_status_and_safe_contract(self):
        recorder = NetworkSelection()
        for path, method, normalized in (
                ('/v3/pay_action/do?token=secret', 'POST', '/v3/pay_action/do'),
                ('/v1/room/secret-room', 'GET', '/v1/room/{room}'),
                ('/v10/texas_holdem/room/secret-room/profile', 'GET', '/v10/texas_holdem/room/{room}/profile')):
            body = {'ok': False, 'error': 'authentication_failed', 'result': {'token': 'secret'}}
            flow = sample(path, body)
            flow.request.method = method
            flow.request.timestamp_start = 123.5
            recorder.observe(flow)
            event = recorder.events[-1]
            self.assertEqual(event['path'], normalized)
            self.assertEqual(event['requestAt'], 123500)
            self.assertFalse(event['ok'])
            self.assertTrue(event['authenticationFailed'])
            self.assertEqual(flow.response.json(), body)
            self.assertNotIn('secret', json.dumps(recorder.snapshot()))
            flow.response = None
            recorder.observe(flow, 'error')
            self.assertNotIn('ok', recorder.events[-1])

    def test_diagnostic_exception_does_not_escape_or_mutate_response(self):
        recorder = NetworkSelection()
        flow = sample('/v3/pay_action/do', {'ok': True, 'error': 'secret'})
        flow.request.method = 'POST'
        recorder.observe(flow)
        self.assertFalse(recorder.events[-1]['authenticationFailed'])
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        flow.request.timestamp_start = float('nan')
        recorder.observe(flow)
        self.assertEqual(flow.response.json(), {'ok': True, 'error': 'secret'})

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
