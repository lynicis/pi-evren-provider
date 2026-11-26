import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvrenKey, fetchEvrenModels } from '../src/evren.ts';

const base = 'https://evren-llmapi.ssyz.org.tr/v1';

test('validates keys with a non-inference authenticated quota request', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, `${base}/quota`);
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
    assert.equal(init?.redirect, 'error');
    return new Response('{}');
  };
  assert.equal(await validateEvrenKey(' test-key ', undefined, fetcher), 'test-key');
  await assert.rejects(validateEvrenKey(' ', undefined, fetcher));
  await assert.rejects(validateEvrenKey('key', AbortSignal.abort(), fetcher));
  assert.equal(calls, 1);
});

test('sanitizes authentication and transport errors', async () => {
  for (const status of [401, 403]) await assert.rejects(validateEvrenKey('key', undefined, async () => new Response('', { status })), /Evren rejected the API key/);
  await assert.rejects(validateEvrenKey('key', undefined, async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(validateEvrenKey('key', undefined, async () => { throw new Error('secret-marker'); }), (error: Error) => !String(error.message).includes('secret-marker') && !String(error.cause).includes('secret-marker'));
});

test('caller and deadline cancellation terminate fetch', async () => {
  const oldTimeout = AbortSignal.timeout;
  const deadline = new AbortController();
  try {
    AbortSignal.timeout = (ms: number) => { assert.equal(ms, 10_000); return deadline.signal; };
    const caller = new AbortController();
    const pending: typeof fetch = (_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      return promise;
    };
    const first = validateEvrenKey('key', caller.signal, pending);
    caller.abort();
    await assert.rejects(first);
    const second = validateEvrenKey('key', undefined, pending);
    deadline.abort();
    await assert.rejects(second);
  } finally { AbortSignal.timeout = oldTimeout; }
});

test('discovers unique catalog IDs and conservative limits', async () => {
  const result = await fetchEvrenModels('key', undefined, async (url, init) => {
    assert.equal(url, `${base}/models`);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer key');
    return Response.json({ data: [{ id: 'tenant/gpt-new', max_model_len: 8192, max_completion_tokens: 16384 }, { id: 'tenant/gpt-new' }, {}, { id: 'tenant/gpt-other' }] });
  });
  assert.deepEqual(result.map(row => row.id), ['tenant/gpt-new', 'tenant/gpt-other']);
  assert.deepEqual(result.map(row => [row.contextWindow, row.maxTokens]), [[8192, 8192], [32768, 4096]]);
  assert.deepEqual(await fetchEvrenModels('key', undefined, async () => Response.json({ data: [] })), []);
});

test('rejects malformed and failed catalogs', async () => {
  for (const response of [new Response('invalid'), Response.json({}), Response.json({ data: [{}] }), new Response('', { status: 500 })]) {
    await assert.rejects(fetchEvrenModels('key', undefined, async () => response));
  }
});
