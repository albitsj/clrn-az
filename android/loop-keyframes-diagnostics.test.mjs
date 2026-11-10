import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);

for (const attachmentFails of [false, true]) {
  test(`static countdown retains original motion failure; attachment failure=${attachmentFails}`, async () => {
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL('./loop-keyframes.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Buffer,
      /** Use production comparators and assertions with only the native transport replaced.
       * @param name - Imported module.
       */
      require: name => require(name),
    });
    const picture = new PNG({ width: 2, height: 2 });
    picture.data.fill(255);
    const png = PNG.sync.write(picture);
    const timeline = Array.from({ length: 10 }, (_, index) => ({ capturedAt: 100 + index * 40, png: png.toString('base64') }));
    let samples = 0;
    const implementation = {
      /** Return the same frozen real pixels once; diagnostics must never resample. */
      _send: async () => { samples++; return timeline; },
    };
    const device = { _connection: { /** Native transport boundary. */ toImpl: () => implementation } };
    const attachments = new Map();
    const info = {
      /** Exercise failing report storage without changing the test outcome.
       * @param name - Attachment label.
       * @param value - Diagnostic content.
       */
      attach: async (name, value) => {
        attachments.set(name, value);
        if (attachmentFails) throw new Error('attachment storage unavailable');
      },
    };
    await assert.rejects(exports.captureMovingKeyframes(device, 'en-signed-in-texas-game-opponent-turn-countdown', info,
      [{ x: 0, y: 0, width: 2, height: 2 }]), error => /第 1 个控件必须运动/.test(error.message));
    assert.equal(samples, 1);
    assert.equal(attachments.size, 11);
    const evidence = JSON.parse([...attachments.values()][0].body);
    assert.deepEqual(evidence.sampleTimes, timeline.map(frame => frame.capturedAt));
    assert.deepEqual(evidence.distances, Array(10).fill(0));
    for (const value of [...attachments.values()].slice(1)) assert.deepEqual(value.body, png);
  });
}
