# Pi Evren Provider

Use Evren through native login and model discovery in Pi and OMP.

[![CI](https://github.com/lynicis/pi-evren-provider/actions/workflows/ci.yml/badge.svg)](https://github.com/lynicis/pi-evren-provider/actions/workflows/ci.yml)

## Features

- Registers `evren` with native API-key login and model discovery.
- OMP reports Evren usage from `/v1/quota`.
- The separate `invokeEvren` helper enforces optional process-local quotas; normal chat does not use it.
- Resets local quotas at minute, hour, or day boundaries.
- Uses no external quota service or database; local state is in memory and resets with the process.

## Install

Install a package version containing native provider support:

```bash
pi install npm:pi-evren-provider
# or
omp plugin install pi-evren-provider
```

Then use `/login evren`, select a discovered model with `/model`, and use `/logout` to remove the locally stored credential. Logout does not revoke the server key.

Previous users should remove only the old Evren provider stanza from their configuration and restart before logging in. The existing npm release may not yet contain these changes.

## Local quotas

Pass a `QuotaConfig` to `invokeEvren`:

```js
const quota = {
  requests: 100,
  inputTokens: 50_000,
  outputTokens: 25_000,
  window: 'hour',
};

const result = await invokeEvren(input, quota, providerCall);
```

| Key | Purpose | Valid window units |
| --- | --- | --- |
| `requests` | Maximum successful provider requests | All |
| `inputTokens` | Maximum input tokens reported by successful calls | All |
| `outputTokens` | Maximum output tokens reported by successful calls | All |
| `window` | Reset interval | `minute`, `hour`, `day` |

Missing, zero, negative, `NaN`, infinite, or otherwise invalid limits disable that limit. With no enabled limits, calls are allowed normally.

Quota usage is checked before invoking the provider callback. A successful call records:

- `requests: 1`
- Finite `inputTokens` returned by the result, or `0`
- Finite `outputTokens` returned by the result, or `0`

Windows reset at epoch-aligned boundaries. State is static, in-process state; it is not shared between workers or persisted across restarts.

### Quota errors

Denied calls throw `EvrenQuotaExceededError`:

```js
{
  name: 'EvrenQuotaExceededError',
  code: 'EVREN_QUOTA_EXCEEDED',
  limit: 'requests', // or inputTokens, outputTokens
  used: 100,
  limitValue: 100,
  resetsAt: 1770000000000,
}
```

The provider callback is not invoked after a quota denial.

## Usage reporting

Provider registration exposes Evren usage metadata:

```js
{
  id: 'evren',
  cacheVersion: 1,
  usesRequestKey: true,
  fetchUsage,
}
```

`fetchUsage` requests `${base}/v1/quota`, removing a trailing `/v1` from the configured base before adding the route. It reports window, daily, and concurrency fields from supported payloads. Authentication failures throw; unavailable or malformed responses return `null` or a partial usage record when possible.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

The test suite uses Node's built-in test runner and has no runtime dependencies.

## Publishing

GitHub Actions tests the package on Node 22 and 24. Publishing runs only when a GitHub release is published and requires the `NPM_TOKEN` repository secret.

```bash
npm version 0.1.1
git push --follow-tags
```

Create the GitHub release for the pushed tag to trigger publication to npm with provenance.
