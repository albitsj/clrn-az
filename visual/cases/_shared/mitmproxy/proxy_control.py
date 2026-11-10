"""Authenticated control dispatch for independent visual proxy processes."""

import json
from urllib.parse import urlsplit

from proxy_http import ProxyHTTP


class ProxyControl(ProxyHTTP):
    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            self.control_reply(flow, {'error': 'Forbidden'}, 403)
            return
        try:
            self.control_command(flow)
        except (ValueError, KeyError, TypeError, AttributeError):
            self.control_reply(flow, {'error': self.invalid_command}, 400)
            return
        self.control_reply(flow, self.status())

    def control_command(self, flow):
        path = urlsplit(flow.request.path).path
        if flow.request.method == 'POST':
            self.post_command(path, json.loads(flow.request.content))
        elif (flow.request.method, path) != ('GET', '/status'):
            raise ValueError('Unknown command')

    def post_command(self, path, body):
        if path == '/scenario':
            self.configure_scenario(body)
        elif path == self.release_path:
            self.release_command(body)
        else:
            self.stable_command(path, body)

    def stable_command(self, path, body):
        if self.scenario != 'visual-stable':
            raise ValueError('Unknown command')
        self.commands()[path](body)

    def configure_scenario(self, body):
        if body.get('scenario') not in (None, 'visual-stable'):
            raise ValueError('Unknown command')
        self.scenario = body['scenario']
        self.reset_scenario()
