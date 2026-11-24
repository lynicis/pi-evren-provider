export function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export type EvrenUsageParams = {
  baseUrl?: string;
  apiKey?: string;
  credential?: {
    type?: string;
    apiKey?: string;
    accessToken?: string;
  };
  signal?: AbortSignal;
  provider?: string;
};

function resolveApiKey(params: EvrenUsageParams): string | undefined {
  const fromCredential =
    params.credential?.type === 'oauth'
      ? params.credential.accessToken
      : params.credential?.apiKey ?? params.credential?.accessToken;
  const raw = fromCredential ?? params.apiKey;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

export function amount(
  used: number | undefined,
  limit: number | undefined,
  remaining: number | undefined,
  unit: string,
  usedFractionOverride?: number,
) {
  const computedRemaining =
    remaining ?? (used !== undefined && limit !== undefined ? Math.max(limit - used, 0) : undefined);
  const rawFraction =
    used !== undefined && limit !== undefined && limit > 0
      ? used / limit
      : usedFractionOverride;
  const usedFraction =
    rawFraction !== undefined && Number.isFinite(rawFraction)
      ? Math.min(Math.max(rawFraction, 0), 1)
      : undefined;
  return {
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(computedRemaining !== undefined ? { remaining: computedRemaining } : {}),
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    ...(usedFraction !== undefined ? { remainingFraction: Math.max(1 - usedFraction, 0) } : {}),
    unit,
  };
}

export function status(used: number | undefined, limit: number | undefined, usedFractionOverride?: number) {
  const fraction =
    used !== undefined && limit !== undefined && limit > 0
      ? used / limit
      : usedFractionOverride;
  if (fraction === undefined || !Number.isFinite(fraction)) return 'unknown';
  if (fraction >= 1) return 'exhausted';
  if (fraction >= 0.9) return 'warning';
  return 'ok';
}

export async function fetchEvrenUsage(
  params: EvrenUsageParams,
  ctx: {
    fetch: (url: string, init: unknown) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;
    logger?: { debug: (message: string, data?: unknown) => void };
  },
) {
  const apiKey = resolveApiKey(params);
  if (!apiKey) return null;
  const provider = params.provider ?? 'evren';
  const base = (params.baseUrl ?? 'https://evren-llmapi.ssyz.org.tr/v1').replace(/\/+$/, '').replace(/\/v1$/i, '');
  let response;
  try {
    response = await ctx.fetch(`${base}/v1/quota`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
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
  const usageRatio = toNumber(fields.usage_ratio);
  const fiveRemaining = toNumber(fields.five_minute_remaining);
  const fiveLimit = toNumber(fields.five_minute_limit);
  const windowUsed = used ?? (fiveRemaining !== undefined && fiveLimit !== undefined ? fiveLimit - fiveRemaining : undefined);
  const windowLimit = cap ?? fiveLimit;
  const rawWindowMinutes = toNumber(fields.window_minutes);
  const windowMinutes = rawWindowMinutes !== undefined && rawWindowMinutes > 0 ? rawWindowMinutes : 5;
  const windowId = `${windowMinutes}m`;

  const dailyUsed = toNumber(fields.daily_used_tokens);
  const dailyLimit = toNumber(fields.daily_limit_tokens) ?? toNumber(fields.daily_limit);
  const dailyRemaining = toNumber(fields.daily_remaining_tokens) ?? toNumber(fields.daily_remaining);
  const computedDailyUsed = dailyUsed ?? (dailyRemaining !== undefined && dailyLimit !== undefined ? dailyLimit - dailyRemaining : undefined);

  const concurrent = toNumber(fields.concurrent_requests);
  const concurrentLimit = toNumber(fields.concurrency_limit);
  const concurrencyRemaining = toNumber(fields.concurrency_remaining);
  const computedConcurrent = concurrent ?? (concurrencyRemaining !== undefined && concurrentLimit !== undefined ? concurrentLimit - concurrencyRemaining : undefined);

  const limits: object[] = [];
  if (windowUsed !== undefined || windowLimit !== undefined || fiveRemaining !== undefined || usageRatio !== undefined) {
    const resetAt = toTimestamp(fields.reset_at);
    limits.push({
      id: 'evren:window', label: 'Token window',
      scope: { provider, windowId },
      window: {
        id: windowId,
        label: `${windowMinutes} Minute`,
        durationMs: windowMinutes * 60_000,
        ...(resetAt !== undefined ? { resetsAt: resetAt } : {}),
      },
      amount: amount(windowUsed, windowLimit, fiveRemaining, 'tokens', usageRatio),
      status: status(windowUsed, windowLimit, usageRatio),
    });
  }
  if (computedDailyUsed !== undefined || dailyLimit !== undefined || dailyRemaining !== undefined) {
    const resetAt = toTimestamp(fields.daily_reset_at);
    limits.push({
      id: 'evren:daily', label: 'Daily tokens',
      scope: { provider, windowId: '1d' },
      window: {
        id: '1d',
        label: 'Daily',
        durationMs: 86_400_000,
        ...(resetAt !== undefined ? { resetsAt: resetAt } : {}),
      },
      amount: amount(computedDailyUsed, dailyLimit, dailyRemaining, 'tokens'),
      status: status(computedDailyUsed, dailyLimit),
    });
  }
  if (computedConcurrent !== undefined || concurrentLimit !== undefined || concurrencyRemaining !== undefined) {
    limits.push({
      id: 'evren:concurrency', label: 'Concurrent requests',
      scope: { provider, windowId: 'concurrency' },
      amount: amount(computedConcurrent, concurrentLimit, concurrencyRemaining, 'requests'),
      status: status(computedConcurrent, concurrentLimit),
    });
  }
  if (limits.length === 0) return null;
  return {
    provider,
    fetchedAt: Date.now(),
    limits,
    ...(typeof fields.level === 'string' ? { notes: [`Quota level: ${fields.level}`] } : {}),
    metadata: { endpoint: `${base}/v1/quota` },
    raw: payload,
  };
}
