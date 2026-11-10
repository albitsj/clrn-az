"""HTTP transport and staging checks for the isolated visual proxies."""

import json
import sys
from pathlib import Path
from mitmproxy import http

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import (  # noqa: E402
    is_staging as is_staging, prepare_profiles as prepare_profiles,
    patch_profiles as patch_profiles, patch_version as patch_version,
)

CONTROL_HOST = 'test-mitmproxy.invalid'


def respond(flow, data, status=200):
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class ProxyHTTP:
    def control_reply(self, flow, data, status=200):
        respond(flow, data, status)

    def active(self, flow):
        return self.scenario == 'visual-stable' and is_staging(flow.request.host)

    def traffic_status(self):
        return {'scenario': self.scenario, 'interceptedRequests': 0,
                'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests}

    def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.active(flow):
            self.fixture_request(flow)
