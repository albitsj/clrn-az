"""Boundary and fail-closed checks for the issue #52 gate."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

import check_e2e_complexity as gate


def branches(complexity, declaration='def probe(value):'):
    body = ''.join(f'    if value == {index}:\n        return {index}\n' for index in range(complexity - 1))
    return f'{declaration}  # noqa: C901\n{body}    return -1\n'


def complexities(source):
    return {row['function']: row['complexity'] for row in gate.measure(textwrap.dedent(source), 'probe.py', 3)}


class MeasurementTests(unittest.TestCase):
    def test_test_support_boundary_is_three(self):
        for complexity, count in ((3, 0), (4, 1)):
            rows = gate.measure(branches(complexity), 'fixtures.py', 3)
            self.assertEqual(rows[0]['complexity'], complexity)
            self.assertEqual(len(gate.failures(rows)), count)

    def test_independent_tool_boundary_is_six(self):
        for complexity, count in ((6, 0), (7, 1)):
            rows = gate.measure(branches(complexity), 'tool.py', 6)
            self.assertEqual(rows[0]['complexity'], complexity)
            self.assertEqual(len(gate.failures(rows)), count)

    def test_async_methods_and_lambdas_are_independent(self):
        measured = complexities('''
            async def outer(value):
                class Nested:
                    def callback(self, n):
                        return 1 if n else 0
                callback = lambda n: 1 if n and value else 0
                return callback(value)
        ''')
        self.assertEqual(measured, {'outer': 1, 'outer.Nested.callback': 2, 'outer.<lambda>': 3})

    def test_nested_function_does_not_accumulate_into_parent(self):
        measured = complexities('''
            def outer(value):
                def callback(n):
                    if n == 1:
                        return 1
                    if n == 2:
                        return 2
                    if n == 3:
                        return 3
                    return 0
                return callback(value)
        ''')
        self.assertEqual(measured, {'outer': 1, 'outer.callback': 4})

    def test_radon_decisions_and_no_assert(self):
        measured = complexities('''
            def conditions(a, b, c):
                assert a and b and c
                return a and b and c
            def comprehension(items):
                return [item for item in items if item]
            def exceptions():
                try:
                    return 1
                except ValueError:
                    return 2
                except TypeError:
                    return 3
        ''')
        self.assertEqual(measured, {'conditions': 3, 'comprehension': 3, 'exceptions': 3})

    def test_nested_lambda_is_not_counted_twice(self):
        self.assertEqual(complexities('callback = lambda x: (lambda y: y if y else x)'),
                         {'<lambda>': 1, '<lambda>.<lambda>': 2})


class GateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def write(self, file, source):
        target = self.root / file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding='utf-8')

    def populate(self, source='def probe():\n    return 1\n'):
        for name in gate.REQUIRED:
            self.write(gate.SUPPORT / f'{name}.py', source)
        for file in gate.TOOLS:
            self.write(file, source)

    def run_gate(self, *flags):
        return subprocess.run([sys.executable, *flags, str(gate.ROOT / 'scripts/check_e2e_complexity.py'),
                               '--root', str(self.root)], capture_output=True, text=True, check=False)

    def test_cli_accepts_boundary_and_rejects_overlimit(self):
        self.populate(branches(3))
        self.assertEqual(self.run_gate().returncode, 0)
        self.write(gate.SUPPORT / 'replay_scenes.py', branches(4))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn('complexity 4 > 3', result.stderr)

    def test_cli_tool_boundary(self):
        self.populate()
        self.write('scripts/check_e2e_complexity.py', branches(6))
        self.assertEqual(self.run_gate().returncode, 0)
        self.write('scripts/check_e2e_complexity.py', branches(7))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn('complexity 7 > 6', result.stderr)

    def test_adjacent_and_nested_helpers_inherit_test_limit(self):
        self.populate()
        for file in ('helper.py', 'extracted/callback.py'):
            self.write(gate.SUPPORT / file, branches(4))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.count('complexity 4 > 3'), 2)

    def test_nested_callback_cannot_hide_behind_noqa(self):
        self.populate()
        source = 'def outer():  # noqa\n' + textwrap.indent(branches(4), '    ') + '    return probe\n'
        self.write(gate.SUPPORT / 'helper.py', source)
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn('outer.probe complexity 4 > 3', result.stderr)

    def test_lambda_and_async_callbacks_cannot_bypass_limit(self):
        self.populate()
        self.write(gate.SUPPORT / 'callbacks.py', 'callback = lambda a, b, c, d: a and b and c and d\n'
                   + branches(4, 'async def asynchronous(value):'))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.count('complexity 4 > 3'), 2)

    def test_parse_error_is_nonzero(self):
        self.populate()
        self.write(gate.SUPPORT / 'helper.py', 'def broken(:')
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SyntaxError', result.stderr)

    def test_missing_dependency_is_nonzero(self):
        self.populate()
        result = self.run_gate('-S')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No module named 'radon'", result.stderr)

    def test_missing_scope_is_nonzero(self):
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing scope files', result.stderr)

    def test_empty_support_scan_is_nonzero(self):
        self.populate('# no functions\n')
        self.write('scripts/check_e2e_complexity.py', 'def tool():\n    pass\n')
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Empty E2E function scan', result.stderr)

    def test_report_contains_every_function(self):
        self.populate()
        result = subprocess.run([sys.executable, str(gate.ROOT / 'scripts/check_e2e_complexity.py'),
                                 '--root', str(self.root), '--report'],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)), len(gate.REQUIRED) + len(gate.TOOLS))

    def prepare_npm_entry(self):
        self.populate()
        for file in ('package.json', 'ruff.toml', 'scripts/check_e2e_complexity.py'):
            shutil.copyfile(gate.ROOT / file, self.root / file)

    def npm_entry(self):
        return subprocess.run(['npm', 'run', 'lint:python:e2e'], cwd=self.root,
                              capture_output=True, text=True, check=False)

    def test_actual_npm_entry_blocks_overlimit(self):
        self.prepare_npm_entry()
        self.write(gate.SUPPORT / 'helper.py', branches(4))
        result = self.npm_entry()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('complexity 4 > 3', result.stderr)

    def test_actual_npm_entry_preserves_ruff_checks(self):
        self.prepare_npm_entry()
        self.assertEqual(self.npm_entry().returncode, 0)
        self.write(gate.SUPPORT / 'helper.py', 'import missing_module  # noqa: F401\n')
        result = self.npm_entry()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('F401', result.stdout)


if __name__ == '__main__':
    unittest.main()
