"""Issue #52: read-only, per-function Radon gate for the E2E proxy scope."""

import argparse
import ast
import json
from pathlib import Path
import sys

from radon.visitors import ComplexityVisitor

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = Path('e2e/mitmproxy')
REQUIRED = (
    'network_faults', 'replay_scenes', 'response_overrides', 'table_scenes',
    'test_native_network', 'test_network_faults', 'test_replay_scenes',
    'test_response_overrides', 'test_response_overrides_integration',
    'test_selection_faults', 'test_visual_fixtures', 'visual_fixtures',
)
TOOLS = {Path('scripts/check_e2e_complexity.py'): 6,
         Path('scripts/test_check_e2e_complexity.py'): 3}


class Decisions(ComplexityVisitor):
    """Use Radon's decisions, excluding independently measured nested scopes."""

    def visit_FunctionDef(self, node):
        pass

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef


def function_complexity(node):
    visitor = Decisions(no_assert=True)
    body = [node.body] if isinstance(node, ast.Lambda) else node.body
    for child in body:
        visitor.visit(child)
    return visitor.complexity


class Functions(ast.NodeVisitor):
    def __init__(self, file, limit):
        self.file = str(file)
        self.limit = limit
        self.parents = []
        self.rows = []

    def visit_ClassDef(self, node):
        self.parents.append(node.name)
        self.generic_visit(node)
        self.parents.pop()

    def visit_FunctionDef(self, node):
        name = getattr(node, 'name', '<lambda>')
        self.rows.append({
            'file': self.file, 'line': node.lineno, 'column': node.col_offset + 1,
            'function': '.'.join([*self.parents, name]),
            'complexity': function_complexity(node), 'limit': self.limit,
        })
        self.parents.append(name)
        self.generic_visit(node)
        self.parents.pop()

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef


def measure(source, file, limit):
    visitor = Functions(file, limit)
    visitor.visit(ast.parse(source, filename=str(file)))
    return visitor.rows


def scoped_files(root):
    # All adjacent/extracted Python helpers inherit the test-support limit.
    required = {SUPPORT / f'{name}.py' for name in REQUIRED} | TOOLS.keys()
    missing = sorted(str(file) for file in required if not (root / file).is_file())
    if missing:
        raise ValueError(f'Missing scope files: {missing}')
    files = {file.relative_to(root) for file in (root / SUPPORT).rglob('*.py')}
    return sorted(files | TOOLS.keys())


def scan(root):
    support_rows, tool_rows = [], []
    for file in scoped_files(root):
        rows = measure((root / file).read_text(encoding='utf-8'), file, TOOLS.get(file, 3))
        if file in TOOLS:
            tool_rows.extend(rows)
        else:
            support_rows.extend(rows)
    if not support_rows:
        raise ValueError('Empty E2E function scan')
    return [*support_rows, *tool_rows]


def failures(rows):
    return [row for row in rows if row['complexity'] > row['limit']]


def check(rows):
    exceeded = failures(rows)
    for row in exceeded:
        print(f"{row['file']}:{row['line']}:{row['column']}: {row['function']} "
              f"complexity {row['complexity']} > {row['limit']}", file=sys.stderr)
    print(f'E2E complexity: {len(rows)} functions, {len(exceeded)} failures')
    return int(bool(exceeded))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--report', action='store_true', help='JSON measurement; no threshold enforcement')
    args = parser.parse_args()
    rows = scan(args.root.resolve())
    if args.report:
        print(json.dumps(rows, indent=2))
        return 0
    return check(rows)


if __name__ == '__main__':
    sys.exit(main())
