// Pi provider registration and invocation wiring live here.
import { fetchEvrenUsage } from './evrenUsage.ts';
import { checkQuota, recordQuotaUsage, type QuotaConfig } from './quota.ts';

export type EvrenProviderCall = (input: unknown) => unknown | Promise<unknown>;

export async function invokeEvren(
  input: unknown,
  quotaConfig: QuotaConfig,
  providerCall?: EvrenProviderCall,
): Promise<unknown> {
  const check = checkQuota(quotaConfig, { requests: 0, inputTokens: 0, outputTokens: 0 });
  if (!check.allowed) {
    const error = new Error('Evren quota exceeded') as Error & Record<string, unknown>;
    error.name = 'EvrenQuotaExceededError';
    error.code = check.code;
    error.limit = check.limit;
    error.used = check.used;
    error.limitValue = check.limitValue;
    error.resetsAt = check.resetsAt;
    throw error;
  }

  if (!providerCall) throw new Error('Evren provider callback is required');
  const result = await providerCall(input);

  const accounting = result && typeof result === 'object'
    ? result as Record<string, unknown>
    : {};
  const inputTokens = typeof accounting.inputTokens === 'number' && Number.isFinite(accounting.inputTokens)
    ? accounting.inputTokens
    : 0;
  const outputTokens = typeof accounting.outputTokens === 'number' && Number.isFinite(accounting.outputTokens)
    ? accounting.outputTokens
    : 0;

  recordQuotaUsage(quotaConfig, { requests: 1, inputTokens, outputTokens });
  return result;
}

export function createEvrenProvider(pi: {
  registerProvider(name: string, descriptor: unknown): unknown;
}): void {
  pi.registerProvider('evren', {
    usage: {
      id: 'evren',
      cacheVersion: 1,
      usesRequestKey: true,
      fetchUsage: fetchEvrenUsage,
    },
  });
}
