import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEvrenUsage } from '../src/evrenUsage.ts';

const ctx = (response: unknown) => ({
  fetch: async () => response,
  logger: { debug: () => { } },
});

const payload = {
  five_minute_remaining: 2,
  five_minute_limit: 10,
  reset_at: '2026-11-22T18:00:00Z',
  daily_remaining: 4,
  daily_limit: 8,
  daily_reset_at: '2026-11-23T00:00:00Z',
  concurrency_remaining: 1,
  concurrency_limit: 2,
  level: 'warning',
};

test('maps Evren usage payload', async () => {
  const result = await fetchEvrenUsage(
    { apiKey: 'secret', baseUrl: 'https://evren.example/v1/' },
    ctx({ status: 200, ok: true, json: async () => payload }),
  );
  assert.ok(result);
  assert.equal(result.provider, 'evren');
  assert.equal(result.limits[0].amount.remaining, 2);
  assert.equal(result.limits[0].amount.limit, 10);
  assert.equal(result.limits[0].status, 'ok');
  assert.equal(result.limits[1].amount.remaining, 4);
  assert.equal(result.limits[1].status, 'ok');
  assert.equal(result.limits[2].amount.remaining, 1);
  assert.equal(result.limits[2].status, 'ok');
  assert.deepEqual(result.notes, ['Quota level: warning']);
  assert.equal(result.metadata.endpoint, 'https://evren.example/v1/quota');
  assert.equal(result.raw, payload);
});

test('reads apiKey from Pi UsageFetchParams.credential and maps live Evren /v1/quota payload', async () => {
  let capturedUrl = '';
  let capturedAuth = '';
  const livePayload = {
    used_tokens: 31893,
    cap: 2500000,
    window_minutes: 5,
    reset_at: '2026-11-24T08:56:00+00:00',
    usage_ratio: 0.0127572,
    level: 'ok',
    daily_used_tokens: 13958402,
    daily_limit_tokens: 15000000,
    daily_remaining_tokens: 1041598,
    daily_reset_at: '2026-11-25T00:00:00Z',
    concurrent_requests: 1,
    concurrency_limit: 8,
  };

  const result = await fetchEvrenUsage(
    {
      provider: 'evren',
      credential: { type: 'api_key', apiKey: '  live-secret  ' },
      baseUrl: 'https://evren-llmapi.ssyz.org.tr/v1',
    },
    {
      fetch: async (url: string, init: any) => {
        capturedUrl = url;
        capturedAuth = init.headers.Authorization;
        return { status: 200, ok: true, json: async () => livePayload };
      },
      logger: { debug: () => {} },
    },
  );

  assert.equal(capturedUrl, 'https://evren-llmapi.ssyz.org.tr/v1/quota');
  assert.equal(capturedAuth, 'Bearer live-secret');
  assert.ok(result);
  assert.equal(result.provider, 'evren');

  assert.equal(result.limits[0].id, 'evren:window');
  assert.equal(result.limits[0].scope.provider, 'evren');
  assert.equal(result.limits[0].window.durationMs, 300_000);
  assert.equal(result.limits[0].amount.used, 31893);
  assert.equal(result.limits[0].amount.limit, 2500000);
  assert.equal(result.limits[0].amount.remaining, 2468107);
  assert.equal(result.limits[0].status, 'ok');

  assert.equal(result.limits[1].id, 'evren:daily');
  assert.equal(result.limits[1].window.durationMs, 86_400_000);
  assert.equal(result.limits[1].amount.used, 13958402);
  assert.equal(result.limits[1].amount.limit, 15000000);
  assert.equal(result.limits[1].amount.remaining, 1041598);
  assert.equal(result.limits[1].status, 'warning');

  assert.equal(result.limits[2].id, 'evren:concurrency');
  assert.equal(result.limits[2].amount.used, 1);
  assert.equal(result.limits[2].amount.limit, 8);
  assert.equal(result.limits[2].amount.remaining, 7);
  assert.equal(result.limits[2].status, 'ok');
});

test('network and invalid payload failures return null', async () => {
  const network = await fetchEvrenUsage(
    { apiKey: 'secret' },
    { fetch: async () => { throw new Error('offline'); }, logger: { debug: () => { } } },
  );
  assert.equal(network, null);
  for (const invalid of [null, 'bad', []]) {
    const result = await fetchEvrenUsage(
      { apiKey: 'secret' },
      ctx({ status: 200, ok: true, json: async () => invalid }),
    );
    assert.equal(result, null);
  }
});

test('401 and 403 throw; 500 returns null', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      fetchEvrenUsage({ apiKey: 'secret' }, ctx({ status, ok: false, json: async () => null })),
      new Error(`EVREN quota endpoint returned ${status}`),
    );
  }
  assert.equal(await fetchEvrenUsage(
    { apiKey: 'secret' },
    ctx({ status: 500, ok: false, json: async () => null }),
  ), null);
});
