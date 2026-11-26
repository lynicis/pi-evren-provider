export const EVREN_BASE_URL = 'https://evren-llmapi.ssyz.org.tr/v1';

export type EvrenModel = {
  id: string;
  name: string;
  input: ['text'];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

async function get(route: 'quota' | 'models', apiKey: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = apiKey.trim();
  if (!key) throw new Error('Evren API key is required');
  if (signal?.aborted) throw new Error('Evren request cancelled');
  const deadline = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let response: Response;
  try {
    response = await fetcher(`${EVREN_BASE_URL}/${route}`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      redirect: 'error', signal: combined,
    });
  } catch {
    throw new Error('Evren request failed');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new Error('Evren rejected the API key');
    throw new Error(`Evren request failed (HTTP ${response.status})`);
  }
  if (route === 'quota') {
    try { await response.body?.cancel(); } catch { throw new Error('Evren request failed'); }
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Evren returned an invalid model catalog');
  }
}

export async function validateEvrenKey(apiKey: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<string> {
  await get('quota', apiKey, signal, fetcher);
  return apiKey.trim();
}

export async function fetchEvrenModels(apiKey: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<EvrenModel[]> {
  const body = await get('models', apiKey, signal, fetcher);
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) throw new Error('Evren returned an invalid model catalog');
  const rows: unknown[] = body.data;
  const models: EvrenModel[] = [];
  const seen = new Set<string>();
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const contextWindow = positive(row.max_model_len) ? row.max_model_len : positive(row.context_length) ? row.context_length : 32768;
    const maxTokens = Math.min(contextWindow, positive(row.max_completion_tokens) ? row.max_completion_tokens : positive(row.max_tokens) ? row.max_tokens : 4096);
    models.push({ id: row.id, name: row.id, input: ['text'], contextWindow, maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  }
  if (rows.length && !models.length) throw new Error('Evren returned an invalid model catalog');
  return models;
}
