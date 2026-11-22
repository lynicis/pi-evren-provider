export function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function amount(used: number | undefined, limit: number | undefined, remaining: number | undefined, unit: string) {
  const usedFraction = used !== undefined && limit !== undefined && limit > 0 ? Math.min(used / limit, 1) : undefined;
  return {
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    ...(usedFraction !== undefined ? { remainingFraction: Math.max(1 - usedFraction, 0) } : {}),
    unit,
  };
}

export function status(used: number | undefined, limit: number | undefined) {
  if (used === undefined || limit === undefined || limit <= 0) return 'unknown';
  const fraction = used / limit;
  if (fraction >= 1) return 'exhausted';
  if (fraction >= 0.9) return 'warning';
  return 'ok';
}

export async function fetchEvrenUsage(
  params: { baseUrl?: string; apiKey: string; signal?: AbortSignal; provider?: string },
  ctx: {
    fetch: (url: string, init: unknown) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;
    logger?: { debug: (message: string, data?: unknown) => void };
  },
) {
  if (!params.apiKey) return null;
  const base = (params.baseUrl ?? 'https://evren-llmapi.ssyz.org.tr/v1').replace(/\/+$/, '').replace(/\/v1$/i, '');
  let response;
  try {
    response = await ctx.fetch(`${base}/v1/quota`, {
      headers: { Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: params.signal,
    });
  } catch (error) {
    ctx.logger?.debug('EVREN quota request failed', { error: String(error) });
    return null;
  }
  if (response.status === 401 || response.status === 403) throw new Error(`EVREN quota endpoint returned ${response.status}`);
  if (!response.ok) {
    ctx.logger?.debug('EVREN quota endpoint unavailable', { status: response.status });
    return null;
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const fields = payload as Record<string, unknown>;

  const used = toNumber(fields.used_tokens);
  const cap = toNumber(fields.cap);
  const fiveRemaining = toNumber(fields.five_minute_remaining);
  const fiveLimit = toNumber(fields.five_minute_limit);
  const windowUsed = used ?? (fiveRemaining !== undefined && fiveLimit !== undefined ? fiveLimit - fiveRemaining : undefined);
  const windowLimit = cap ?? fiveLimit;

  const dailyUsed = toNumber(fields.daily_used_tokens);
  const dailyLimit = toNumber(fields.daily_limit_tokens) ?? toNumber(fields.daily_limit);
  const dailyRemaining = toNumber(fields.daily_remaining_tokens) ?? toNumber(fields.daily_remaining);
  const computedDailyUsed = dailyUsed ?? (dailyRemaining !== undefined && dailyLimit !== undefined ? dailyLimit - dailyRemaining : undefined);

  const concurrent = toNumber(fields.concurrent_requests);
  const concurrentLimit = toNumber(fields.concurrency_limit);
  const concurrencyRemaining = toNumber(fields.concurrency_remaining);
  const computedConcurrent = concurrent ?? (concurrencyRemaining !== undefined && concurrentLimit !== undefined ? concurrentLimit - concurrencyRemaining : undefined);

  const limits: object[] = [];
  if (windowUsed !== undefined || windowLimit !== undefined || fiveRemaining !== undefined) {
    const resetAt = toTimestamp(fields.reset_at);
    limits.push({
      id: 'evren:window', label: 'Token window',
      scope: { provider: params.provider, windowId: '5m' },
      window: { id: '5m', label: '5 Minute', ...(resetAt !== undefined ? { resetsAt: resetAt } : {}) },
      amount: amount(windowUsed, windowLimit, fiveRemaining, 'tokens'),
      status: status(windowUsed, windowLimit),
    });
  }
  if (computedDailyUsed !== undefined || dailyLimit !== undefined || dailyRemaining !== undefined) {
    const resetAt = toTimestamp(fields.daily_reset_at);
    limits.push({
      id: 'evren:daily', label: 'Daily tokens',
      scope: { provider: params.provider, windowId: '1d' },
      window: { id: '1d', label: 'Daily', ...(resetAt !== undefined ? { resetsAt: resetAt } : {}) },
      amount: amount(computedDailyUsed, dailyLimit, dailyRemaining, 'tokens'),
      status: status(computedDailyUsed, dailyLimit),
    });
  }
  if (computedConcurrent !== undefined || concurrentLimit !== undefined || concurrencyRemaining !== undefined) {
    limits.push({
      id: 'evren:concurrency', label: 'Concurrent requests',
      scope: { provider: params.provider, windowId: 'concurrency' },
      amount: amount(computedConcurrent, concurrentLimit, concurrencyRemaining, 'requests'),
      status: status(computedConcurrent, concurrentLimit),
    });
  }
  if (limits.length === 0) return null;
  return {
    provider: params.provider,
    fetchedAt: Date.now(),
    limits,
    ...(typeof fields.level === 'string' ? { notes: [`Quota level: ${fields.level}`] } : {}),
    metadata: { endpoint: `${base}/v1/quota` },
    raw: payload,
  };
}
