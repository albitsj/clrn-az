"""资料诊断不得改变原消息，也不得暴露身份或异常内容。"""

from copy import deepcopy
from types import SimpleNamespace
import unittest
from profile_diagnostics import observe_profile_frame, room_profile_path


class ProfileDiagnosticsTests(unittest.TestCase):
    def test_profile_metadata_does_not_copy_identity_body_or_change_frames(self):
        events = []
        observer = SimpleNamespace(observe=lambda flow, event, **details: events.append((event, details)))
        flow = SimpleNamespace(metadata={})
        request = {'id': 7, 'method': 9, 'params': {'data': {
            'path': '/v10/texas_holdem/room/private-room/profile', 'token': 'private-token'}}}
        response = {'id': 7, 'result': {'data': {'ok': True, 'result': {'secret': 'private-value'}}}}
        original = deepcopy((request, response))
        observe_profile_frame(observer, flow, SimpleNamespace(from_client=True), request)
        observe_profile_frame(observer, flow, SimpleNamespace(from_client=False), response)
        self.assertEqual(events, [('room-profile-request', {}), ('room-profile-response', {
            'transportError': False, 'rpcOk': True, 'resultEntries': 1})])
        self.assertEqual((request, response), original)
        self.assertNotIn('private', str(events))
        observe_profile_frame(observer, flow, SimpleNamespace(from_client=False), response)
        self.assertEqual(len(events), 2)

    def test_failure_response_and_diagnostic_failure_do_not_raise(self):
        events = []
        observer = SimpleNamespace(observe=lambda flow, event, **details: events.append((event, details)))
        flow = SimpleNamespace(metadata={'room_profile_diagnostic_pending': {7}})
        observe_profile_frame(observer, flow, SimpleNamespace(from_client=False), {
            'id': 7, 'error': {'message': 'private-error'}})
        self.assertEqual(events, [('room-profile-response', {
            'transportError': True, 'rpcOk': None, 'resultEntries': None})])

        def failed_observer(*args, **kwargs):
            raise OSError('private-diagnostic-error')

        flow.metadata['room_profile_diagnostic_pending'].add(8)
        observe_profile_frame(SimpleNamespace(observe=failed_observer), flow,
                              SimpleNamespace(from_client=False), {'id': 8})
        self.assertNotIn('private', str(events))

    def test_only_exact_profile_paths_are_observed(self):
        self.assertTrue(room_profile_path('/v10/texas_holdem/room/private-room/profile'))
        for path in (None, '/v10/wallet/private-user', '/v10/texas_holdem/room/id/profile/extra'):
            self.assertFalse(room_profile_path(path))
