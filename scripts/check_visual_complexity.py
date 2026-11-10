"""Issue #53: independent per-function gate for visual proxies and replay support."""

from pathlib import Path
import sys

from check_e2e_complexity import failures as failures, measure, main as run_gate

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    '_shared': ('replay_protocol', 'replay_games', 'proxy_control', 'proxy_http', 'room_creation'),
    'club': ('addon', 'test_addon'),
    'game-record': ('addon', 'data', 'record_fixtures', 'test_addon'),
    'texas-holdem': ('addon', 'game_log', 'records_v2', 'room_view', 'test_addon',
                     'test_records_v2', 'test_room_view', 'test_texas_replay', 'test_ui_states',
                     'texas_replay', 'ui_states'),
    'zhajinhua': ('addon', 'test_addon', 'test_zhajinhua_replay', 'zhajinhua_replay'),
}
TOOLS = {Path('scripts/check_visual_complexity.py'): 6,
         Path('scripts/test_check_visual_complexity.py'): 3}


def support_paths():
    return [Path('visual/cases') / case / 'mitmproxy' for case in REQUIRED]


def required_files():
    return {Path('visual/cases') / case / 'mitmproxy' / f'{name}.py'
            for case, names in REQUIRED.items() for name in names}


def scoped_files(root):
    required = required_files() | TOOLS.keys()
    missing = sorted(str(file) for file in required if not (root / file).is_file())
    if missing:
        raise ValueError(f'Missing scope files: {missing}')
    files = {file.relative_to(root) for path in support_paths()
             for file in (root / path).rglob('*.py')}
    return sorted(files | TOOLS.keys())


def scan(root):
    rows, support_rows = [], []
    for file in scoped_files(root):
        measured = measure((root / file).read_text(encoding='utf-8'), file, TOOLS.get(file, 3))
        rows.extend(measured)
        if file not in TOOLS:
            support_rows.extend(measured)
    if not support_rows:
        raise ValueError('Empty visual function scan')
    return rows


def main():
    return run_gate(scan, __doc__, 'Visual')


if __name__ == '__main__':
    sys.exit(main())
