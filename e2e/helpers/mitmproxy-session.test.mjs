import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { withMitmproxy } = require('./mitmproxy-session.ts');
const { MitmdumpProcess } = require('./mitmproxy-process.ts');

/**
 * Keep real session control flow while replacing the external proxy and filesystem.
 * @param context - Isolated test mocks.
 * @param failures - Optional startup, shutdown and certificate cleanup failures.
 */
function session(context, failures = {}) {
  const calls = [];
  context.mock.method(fs, 'mkdtemp', async () => '/test-only/mitmproxy');
  context.mock.method(fs, 'rm', async () => {
    calls.push('remove');
    if (failures.remove) throw failures.remove;
  });
  context.mock.method(childProcess, 'spawn', () => new EventEmitter());
  context.mock.method(MitmdumpProcess.prototype, 'waitUntilReady', async () => {
    calls.push('ready');
    if (failures.ready) throw failures.ready;
  });
  context.mock.method(MitmdumpProcess.prototype, 'stop', async () => {
    calls.push('stop');
    if (failures.stop) throw failures.stop;
  });
  return calls;
}

test('proxy task, stop and certificate removal errors survive in order', async context => {
  const primary = new Error('original test failure');
  const stop = new Error('proxy shutdown failure');
  const remove = new Error('certificate removal failure');
  const calls = session(context, { stop, remove });
  await assert.rejects(withMitmproxy(async () => { throw primary; }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, stop, remove]);
    for (const failure of error.errors) assert.ok(error.message.includes(failure.message));
    return true;
  });
  assert.deepEqual(calls, ['ready', 'stop', 'remove']);
});

for (const phase of ['ready', 'prepare', 'task']) {
  test(`${phase} failure retains identity when cleanup succeeds`, async context => {
    const primary = new Error(`${phase} failure`);
    const calls = session(context, phase === 'ready' ? { ready: primary } : {});
    await assert.rejects(withMitmproxy(async () => {
      calls.push('task');
      if (phase === 'task') throw primary;
      assert.fail('test must not start after setup failure');
    }, { /** Fail preparation before the task when requested. */ prepare: async () => {
      calls.push('prepare');
      if (phase === 'prepare') throw primary;
    } }), error => error === primary);
    assert.deepEqual(calls.slice(-2), ['stop', 'remove']);
    if (phase !== 'task') assert.ok(!calls.includes('task'));
  });
}

test('startup failure and cleanup failures are all retained', async context => {
  const ready = new Error('startup failure');
  const stop = new Error('shutdown failure');
  const calls = session(context, { ready, stop });
  await assert.rejects(withMitmproxy(async () => assert.fail('must not run')), error => {
    assert.deepEqual(error.errors, [ready, stop]);
    assert.equal(error.cause, ready);
    return true;
  });
  assert.deepEqual(calls, ['ready', 'stop', 'remove']);
});

for (const phase of ['stop', 'remove']) {
  test(`successful task still fails on ${phase} and preserves cleanup error`, async context => {
    const failure = new Error(`${phase} failure`);
    const calls = session(context, { [phase]: failure });
    await assert.rejects(withMitmproxy(async () => 'success'), error => error === failure);
    assert.deepEqual(calls, ['ready', 'stop', 'remove']);
  });
}

test('successful task returns original result after both cleanup stages', async context => {
  const calls = session(context);
  const expected = { complete: true };
  assert.equal(await withMitmproxy(async () => expected), expected);
  assert.deepEqual(calls, ['ready', 'stop', 'remove']);
});
