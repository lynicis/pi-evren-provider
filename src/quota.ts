export type QuotaConfig = {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  window?: 'minute' | 'hour' | 'day';
};

export type QuotaUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export type QuotaCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      code: 'EVREN_QUOTA_EXCEEDED';
      limit: string;
      used: number;
      limitValue: number;
      resetsAt: number;
    };

export type QuotaState = {
  windowStart: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

function windowMs(config: QuotaConfig): number | null {
  if (config.window === 'minute') return 60_000;
  if (config.window === 'hour') return 3_600_000;
  if (config.window === 'day') return 86_400_000;
  return null;
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function windowBoundary(config: QuotaConfig, nowMs: number): { start: number; ms: number } | null {
  const ms = windowMs(config);
  if (ms === null) return null;
  return { start: Math.floor(nowMs / ms) * ms, ms };
}

let state: QuotaState = { windowStart: -1, requests: 0, inputTokens: 0, outputTokens: 0 };
let currentWindowMs = 0;

export function createQuotaState(config: QuotaConfig, nowMs = Date.now()): QuotaState {
  const boundary = windowBoundary(config, nowMs);
  state = boundary
    ? { windowStart: boundary.start, requests: 0, inputTokens: 0, outputTokens: 0 }
    : { windowStart: -1, requests: 0, inputTokens: 0, outputTokens: 0 };
  currentWindowMs = boundary?.ms ?? 0;
  return { ...state };
}

function syncState(config: QuotaConfig, nowMs: number): void {
  const boundary = windowBoundary(config, nowMs);
  if (boundary === null) return;
  if (state.windowStart !== boundary.start || currentWindowMs !== boundary.ms) {
    state = { windowStart: boundary.start, requests: 0, inputTokens: 0, outputTokens: 0 };
    currentWindowMs = boundary.ms;
  }
}

export function checkQuota(config: QuotaConfig, usage: QuotaUsage, nowMs = Date.now()): QuotaCheckResult {
  syncState(config, nowMs);
  const boundary = windowBoundary(config, nowMs);
  if (boundary === null) return { allowed: true };

  const candidates = [
    ['requests', validLimit(config.requests) ? config.requests : null, usage.requests + state.requests],
    ['inputTokens', validLimit(config.inputTokens) ? config.inputTokens : null, usage.inputTokens + state.inputTokens],
    ['outputTokens', validLimit(config.outputTokens) ? config.outputTokens : null, usage.outputTokens + state.outputTokens],
  ] as const;

  for (const [limit, limitValue, used] of candidates) {
    if (limitValue !== null && Number.isFinite(used) && used >= limitValue) {
      return {
        allowed: false,
        code: 'EVREN_QUOTA_EXCEEDED',
        limit,
        used,
        limitValue,
        resetsAt: boundary.start + boundary.ms,
      };
    }
  }
  return { allowed: true };
}

export function recordQuotaUsage(config: QuotaConfig, usage: QuotaUsage): void {
  syncState(config, Date.now());
  if (validLimit(config.requests) && Number.isFinite(usage.requests)) state.requests += usage.requests;
  if (validLimit(config.inputTokens) && Number.isFinite(usage.inputTokens)) state.inputTokens += usage.inputTokens;
  if (validLimit(config.outputTokens) && Number.isFinite(usage.outputTokens)) state.outputTokens += usage.outputTokens;
}

