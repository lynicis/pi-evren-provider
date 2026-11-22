import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuota, createQuotaState, recordQuotaUsage } from '../src/quota.ts';

const usage = (requests = 0, inputTokens = 0, outputTokens = 0) => ({ requests, inputTokens, outputTokens });

test('request limit allows 0 through 4 and rejects 5', () => {
  const config = { requests: 5, window: 'minute' as const };
  for (let used = 0; used < 5; used++) {
    assert.equal(checkQuota(config, usage(used), 60_000).allowed, true);
  }
  assert.deepEqual(checkQuota(config, usage(5), 60_000), {
    allowed: false,
    code: 'EVREN_QUOTA_EXCEEDED',
    limit: 'requests',
    used: 5,
    limitValue: 5,
    resetsAt: 120_000,
  });
});

test('input and output token limits independently reject at or above their values', () => {
  const input = { inputTokens: 100, window: 'hour' as const };
  const output = { outputTokens: 50, window: 'day' as const };
  assert.equal(checkQuota(input, usage(0, 99), 0).allowed, true);
  assert.equal(checkQuota(input, usage(0, 100), 0).allowed, false);
  assert.equal(checkQuota(output, usage(0, 0, 49), 0).allowed, true);
  assert.equal(checkQuota(output, usage(0, 0, 50), 0).allowed, false);
});

test('omitted, zero, and malformed limits are disabled', () => {
  assert.equal(checkQuota({}, usage(1_000), 0).allowed, true);
  for (const requests of [0, -1, Number.NaN, Infinity, '5']) {
    assert.equal(checkQuota({ requests } as never, usage(1_000), 0).allowed, true);
  }
});

test('windows use epoch-aligned resets', () => {
  assert.equal(checkQuota({ requests: 1, window: 'minute' }, usage(1), 61_000).resetsAt, 120_000);
  assert.equal(checkQuota({ requests: 1, window: 'hour' }, usage(1), 3_600_001).resetsAt, 7_200_000);
  assert.equal(checkQuota({ requests: 1, window: 'day' }, usage(1), 86_400_001).resetsAt, 172_800_000);
});

test('unknown windows and cross-boundary accounting roll over', () => {
  assert.equal(checkQuota({ requests: 1, window: 'week' as never }, usage(1), 0).allowed, true);
  assert.deepEqual(createQuotaState({ requests: 2, window: 'minute' }, 60_000), {
    windowStart: 60_000,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  recordQuotaUsage({ requests: 2, window: 'minute' }, usage(1));
  assert.equal(checkQuota({ requests: 2, window: 'minute' }, usage(2), Date.now()).allowed, false);
});

