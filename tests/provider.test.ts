import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeEvren, createEvrenProvider } from '../src/provider.ts';
import { createQuotaState } from '../src/quota.ts';

test('direct invocation denies exhausted quota before provider work', async () => {
  const config = { requests: 1, window: 'minute' } as const;
  createQuotaState(config);

  await invokeEvren({}, config, async () => ({ ok: true }));

  let calls = 0;
  await assert.rejects(
    invokeEvren({}, config, async () => {
      calls++;
      return { ok: true };
    }),
    (error: any) => {
      assert.equal(error.name, 'EvrenQuotaExceededError');
      assert.equal(error.code, 'EVREN_QUOTA_EXCEEDED');
      assert.equal(error.limit, 'requests');
      assert.equal(error.limitValue, 1);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test('direct invocation allows, records success, and denies the next call', async () => {
  const config = { requests: 1, window: 'minute' } as const;
  createQuotaState(config);
  const first = await invokeEvren({}, config, async () => ({ inputTokens: 3, outputTokens: 4 }));
  assert.deepEqual(first, { inputTokens: 3, outputTokens: 4 });
  await assert.rejects(
    invokeEvren({}, config, async () => { throw new Error('provider should not run'); }),
    (error: any) => error.code === 'EVREN_QUOTA_EXCEEDED',
  );
});

test('registered usage descriptor preserves source-exact metadata', () => {
  let descriptor: any;
  const pi = { registerProvider(_name: string, value: any) { descriptor = value; } };
  createEvrenProvider(pi);
  assert.equal(descriptor.usage.id, 'evren');
  assert.equal(descriptor.usage.cacheVersion, 1);
  assert.equal(descriptor.usage.usesRequestKey, true);
  assert.equal(typeof descriptor.usage.fetchUsage, 'function');
});

