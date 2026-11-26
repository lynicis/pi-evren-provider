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

test('native login, discovery and usage share the key', async () => {
  let descriptor: {
    oauth: { login(callbacks: { onPrompt(prompt: { message: string; secret: boolean }): Promise<string>; fetch: typeof fetch }): Promise<string> };
    fetchDynamicModels(key?: string): Promise<{ id: string }[]>;
    usage: { fetchUsage(params: { apiKey: string }, ctx: { fetch: typeof fetch }): Promise<unknown> };
  } | undefined;
  createEvrenProvider({ registerProvider(_name, value) { descriptor = value as typeof descriptor; } });
  assert.ok(descriptor);
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push(String(url));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
    return String(url).endsWith('/models') ? Response.json({ data: [{ id: 'tenant/gpt-new' }] }) : Response.json({});
  };
  const key = await descriptor.oauth.login({ onPrompt: async (prompt: unknown) => {
    assert.deepEqual(prompt, { message: 'Evren API key', secret: true });
    return ' test-key ';
  }, fetch: fetcher });
  assert.equal(key, 'test-key');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    assert.deepEqual(await descriptor.fetchDynamicModels(undefined), []);
    assert.deepEqual((await descriptor.fetchDynamicModels(key)).map(row => row.id), ['tenant/gpt-new']);
    await descriptor.usage.fetchUsage({ apiKey: key }, { fetch: fetcher });
    await assert.rejects(descriptor.oauth.login({ onPrompt: async () => 'bad', fetch: async () => new Response('', { status: 401 }) }), /Evren rejected the API key/);
    await assert.rejects(descriptor.oauth.login({ onPrompt: async () => { throw new Error('cancelled'); }, fetch: fetcher }), /cancelled/);
    assert.equal(requests.length, 3);
  } finally { globalThis.fetch = oldFetch; }
});

