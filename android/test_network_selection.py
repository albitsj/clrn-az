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
    def test_pre_http_diagnostics_are_bounded_private_and_read_only(self):
        recorder = NetworkSelection()
        server = SimpleNamespace(address=(HOST, 443), error='secret error')
        data = SimpleNamespace(context=SimpleNamespace(server=server, client=server), ssl_conn='secret tls')
        for _ in range(201):
            recorder.connection(HOST, 'connect')
        recorder.tls_failure(data, 'tls-client-failed')
        recorder.tls_failure(data, 'tls-server-failed')
        recorder.connection('secret.example.com', 'connect')
        recorder.connection(HOST, 'secret event')
        recorder.connection(None, 'connect')
        recorder.tls_failure(None, 'tls-client-failed')
        state = recorder.snapshot()
        self.assertEqual(state['total'], 0)
        self.assertEqual(state['events'], [])
        self.assertEqual(state['connectionTotal'], 203)
        self.assertEqual(len(state['connections']), 200)
        self.assertEqual(state['connections'][-1]['event'], 'tls-server-failed')
        self.assertNotIn('secret', json.dumps(state))
        self.assertEqual(server.error, 'secret error')
        self.assertEqual(data.ssl_conn, 'secret tls')

    def test_tls_failure_copies_only_classification_from_the_failed_peer(self):
        recorder = NetworkSelection()
        server = SimpleNamespace(address=(HOST, 443), error='secret server timeout')
        client = SimpleNamespace(error='secret client certificate unknown ca')
        data = SimpleNamespace(context=SimpleNamespace(server=server, client=client))
        recorder.tls_failure(data, 'tls-client-failed')
        recorder.tls_failure(data, 'tls-server-failed')
        self.assertEqual([item['failureKind'] for item in recorder.connections], ['certificate', 'timeout'])
        for message, expected in (('secret EOF', 'closed'), ('secret cancelled', 'cancelled'),
                                  ('secret protocol version', 'protocol'), ('secret', 'other'), (None, 'other')):
            client.error = message
            recorder.tls_failure(data, 'tls-client-failed')
            self.assertEqual(recorder.connections[-1]['failureKind'], expected)
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        recorder.tls_failure(SimpleNamespace(), 'tls-client-failed')
        self.assertEqual(recorder.connection_total, 7)

    def test_health_request_and_transport_failure_preserve_flow_and_hide_error(self):
        recorder = NetworkSelection()
        flow = sample('/node/v1/status?token=secret-token')
        flow.response = None
        recorder.room_profile_request(flow)
        flow.error = SimpleNamespace(msg='TLS certificate secret-host secret-token')
        recorder.observe(flow, 'error')
        self.assertEqual([item['event'] for item in recorder.events], ['request', 'error'])
        self.assertEqual(recorder.events[-1]['failureKind'], 'tls')
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        self.assertIsNone(flow.response)
        self.assertIn('secret-token', flow.request.path)

    def test_room_profile_trace_distinguishes_inbound_response_and_transport_error_without_identity(self):
        recorder = NetworkSelection()
        flow = sample('/v10/texas_holdem/room/secret-room/profile?token=secret-token', {'secret': 'body'})
        flow.response = None
        recorder.room_profile_request(flow)
        self.assertEqual(recorder.events[-1]['event'], 'request')
        flow.error = SimpleNamespace(msg='TLS certificate failed for secret-host/secret-room')
        recorder.observe(flow, 'error')
        self.assertEqual(recorder.events[-1]['failureKind'], 'tls')
        flow.response = SimpleNamespace(status_code=502, json=lambda: {'secret': 'body'})
        recorder.observe(flow)
        self.assertEqual(recorder.events[-1]['status'], 502)
        self.assertEqual(recorder.events[-1]['path'], '/v10/texas_holdem/room/{room}/profile')
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))
        self.assertEqual(flow.response.json(), {'secret': 'body'})
        recorder.room_profile_request(sample('/v10/profile/users'))
        self.assertEqual(recorder.total, 3)

    def test_room_profile_request_diagnostic_failure_cannot_abort_request(self):
        recorder = NetworkSelection()
        recorder.observe = lambda *args: (_ for _ in ()).throw(RuntimeError('diagnostic unavailable'))
        recorder.room_profile_request(sample('/v10/texas_holdem/room/secret-room/profile'))
        recorder.room_profile_request(sample('/node/v1/status'))
        self.assertEqual(recorder.total, 0)

    def test_room_failures_trace_request_status_and_safe_outcome_without_mutation(self):
        recorder = NetworkSelection()
        for path, method, redacted, status in (
                ('/v3/pay_action/do', 'POST', '/v3/pay_action/do', 500),
                ('/v1/room/secret-room', 'GET', '/v1/room/{room}', 200),
                ('/v10/texas_holdem/room/secret-room/enter', 'PUT',
                 '/v10/texas_holdem/room/{room}/enter', 503)):
            flow = sample(path + '?token=secret')
            flow.request.method = method
            flow.request.timestamp_start = 12.5
            flow.response = None
            recorder.room_profile_request(flow)
            self.assertEqual(recorder.events[-1]['event'], 'request')
            self.assertEqual(recorder.events[-1]['path'], redacted)
            self.assertEqual(recorder.events[-1]['requestAt'], 12500)
            body = {'ok': False, 'error': 'authentication_failed', 'result': 'secret'}
            response = SimpleNamespace(status_code=status, json=lambda: body)
            flow.response = response
            recorder.observe(flow)
            self.assertEqual(recorder.events[-1]['status'], status)
            self.assertTrue(recorder.events[-1]['authenticationFailed'])
            self.assertIs(recorder.events[-1]['ok'], False)
            self.assertIs(flow.response, response)
            self.assertIs(flow.response.json(), body)
            flow.response.json = lambda: (_ for _ in ()).throw(RuntimeError('secret'))
            recorder.observe(flow)  # 诊断读取异常不能阻断原始响应。
            self.assertIs(flow.response, response)
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))

    def test_room_response_records_only_fixed_failure_flags(self):
        # 复用 b4772ea 的脱敏业务错误检查，不复制错误原文。
        recorder = NetworkSelection()
        for code, description in (('authentication_failed', 'secret'), ('secret', '重复提交'),
                                  ('secret', 'Room already exists')):
            body = {'ok': False, 'error': code, 'error_description': description, 'result': 'secret'}
            flow = sample('/v3/pay_action/do', body)
            flow.request.method = 'POST'
            recorder.observe(flow)
            self.assertEqual(recorder.events[-1]['authenticationFailed'], code == 'authentication_failed')
            self.assertEqual(recorder.events[-1]['duplicateSubmission'], description == '重复提交')
            self.assertEqual(recorder.events[-1]['roomAlreadyExists'], description == 'Room already exists')
            self.assertIs(flow.response.json(), body)
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))

    def test_room_error_variants_remain_fixed_flags_without_copying_body(self):
        recorder = NetworkSelection()
        for container in (None, 'error', 'result'):
            for key in ('error', 'error_description', 'error_message', 'message'):
                for message, flag in (('Room already exists', 'roomAlreadyExists'),
                                      ('重复提交', 'duplicateSubmission')):
                    details = {key: message, 'token': 'secret'}
                    body = {'ok': False, **details} if container is None else {'ok': False, container: details}
                    flow = sample('/v3/pay_action/do', body)
                    flow.request.method = 'POST'
                    recorder.observe(flow)
                    self.assertTrue(recorder.events[-1][flag])
                    self.assertIs(flow.response.json(), body)
        flow = sample('/v3/pay_action/do', {'ok': False, 'message': 'secret Room already exists'})
        flow.request.method = 'POST'
        recorder.observe(flow)
        self.assertFalse(recorder.events[-1]['roomAlreadyExists'])
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))

    def test_certificate_failure_subtype_is_private_and_uses_failed_peer(self):
        recorder = NetworkSelection()
        server = SimpleNamespace(address=(HOST, 443), error='secret certificate expired')
        client = SimpleNamespace(error='secret unknown ca')
        data = SimpleNamespace(context=SimpleNamespace(server=server, client=client))
        recorder.tls_failure(data, 'tls-client-failed')
        recorder.tls_failure(data, 'tls-server-failed')
        self.assertEqual([item['certificateFailure'] for item in recorder.connections], ['unknown-ca', 'expired'])
        for message, expected in (('secret bad_certificate', 'bad-certificate'),
                                  ('secret certificate unknown', 'certificate-unknown'),
                                  ('secret certificate verify failed', 'verify-failed'),
                                  ('secret certificate', 'other')):
            client.error = message
            recorder.tls_failure(data, 'tls-client-failed')
            self.assertEqual(recorder.connections[-1]['certificateFailure'], expected)
            self.assertEqual(recorder.connections[-1]['failureKind'], 'certificate')
        self.assertEqual(server.error, 'secret certificate expired')
        self.assertNotIn('secret', json.dumps(recorder.snapshot()))

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
