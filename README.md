# Pi Evren Provider

Pi provider registration and local quota enforcement for the Evren OpenAI-compatible API.

## Provider configuration

Configure Evren in `~/.omp/agent/models.yml`:

```yaml
providers:
  evren:
    baseUrl: https://evren-llmapi.ssyz.org.tr/v1
    apiKey: EVREN_API_KEY
    auth: apiKey
    authHeader: true
    api: openai-responses
    discovery:
      type: openai-models-list
    remoteCompaction:
      enabled: false
```

`EVREN_API_KEY` is the environment variable containing the API key.

## Quotas

Pass a `QuotaConfig` to `invokeEvren`:

```ts
const quota = {
  requests: 100,
  inputTokens: 50_000,
  outputTokens: 25_000,
  window: 'hour',
};
```

Supported keys:

- `requests`: maximum successful provider requests
- `inputTokens`: maximum input tokens recorded from successful results
- `outputTokens`: maximum output tokens recorded from successful results
- `window`: `minute`, `hour`, or `day`

Omitted, zero, negative, NaN, infinite, or otherwise invalid limits are disabled. With no valid limits, quota checks allow calls. Windows reset at epoch-aligned boundaries and have no external quota service dependency.

The pre-call check uses zero usage, and successful calls record one request plus finite `inputTokens` and `outputTokens` values from the provider result. Missing or non-finite token values are recorded as `0`.

## Quota errors

When a limit is reached, the provider throws `EvrenQuotaExceededError` with:

- `code`: `EVREN_QUOTA_EXCEEDED`
- `limit`: `requests`, `inputTokens`, or `outputTokens`
- `used`: usage in the current window
- `limitValue`: configured limit
- `resetsAt`: epoch-millisecond reset time

The provider callback is not invoked after a quota denial.
