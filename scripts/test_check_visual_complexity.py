"""Exercise the visual gate with the shared boundary and fail-closed contract."""

import unittest

import check_visual_complexity as gate
import test_check_e2e_complexity as shared


class MeasurementTests(shared.MeasurementTests):
    """Both scopes use the same independently measured Radon function walker."""


class GateTests(shared.GateTests):
    gate = gate
    support = gate.support_paths()[0]
    checker = 'scripts/check_visual_complexity.py'
    checker_dependencies = ('scripts/check_e2e_complexity.py',)
    entry = 'lint:python:visual'
    empty_message = 'Empty visual function scan'
    expected_rows = len(gate.required_files()) + len(gate.TOOLS)

    def populate(self, source='def probe():\n    return 1\n'):
        for file in gate.required_files() | gate.TOOLS.keys():
            self.write(file, source)

    def test_every_visual_scope_inherits_the_test_support_limit(self):
        self.populate()
        for support in gate.support_paths():
            self.write(support / 'fixture_helper.py', shared.branches(4))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.count('complexity 4 > 3'), len(gate.support_paths()))

    def test_checker_tests_cannot_use_the_tool_limit(self):
        self.populate()
        self.write('scripts/test_check_visual_complexity.py', shared.branches(4))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn('complexity 4 > 3', result.stderr)


if __name__ == '__main__':
    unittest.main()
