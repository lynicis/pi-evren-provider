# Pi Evren Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- `) syntax for tracking.

**Goal:** Build a minimal Pi provider plugin that preserves Evren usage behavior and applies opt-in, fail-safe quota enforcement to every Evren invocation path.

**Architecture:** Port the existing Evren usage fetcher into a small Pi extension entrypoint, add a dependency-free quota policy module with fixed in-memory windows, and route only explicit plugin invocation paths through one shared quota gate. The existing Evren request/provider configuration remains in `~/.omp/agent/models.yml`; this repository does not replace or duplicate it.

**Tech Stack:** JavaScript/TypeScript supported by Pi, Node built-in test runner, existing Evren HTTP API, Pi extension provider registration.

**Spec:** `docs/superpowers/specs/2026-11-22-pi-evren-provider-design.md`

## Global Constraints

- Preserve Evren usage behavior exactly: default base `https://evren-llmapi.ssyz.org.tr/v1`, normalize trailing slashes and `/v1`, query `GET <base>/v1/quota` with Bearer auth and `Accept: application/json`, and use `redirect: "error"` plus the supplied signal.
- Keep quota checks opt-in: every quota limit defaults to disabled; omitted or invalid static configuration must not impose a limit.
- Fail safely before provider work: a quota-exceeded result throws a deterministic error object with code `EVREN_QUOTA_EXCEEDED` and no provider HTTP request.
- Treat 401/403 as hard usage-fetch failures (`EVREN quota endpoint returned <status>`); network and other non-OK responses retain null behavior where the source does.
- Keep the adapter thin: no model behavior, retry, or response-format forks beyond the source-port contract.

## Review Focus

- Quota boundary at exactly the limit: the fifth request succeeds if the limit is 5, but the sixth throws; own in `quota.test.ts` Task 3.
- Window rollover: usage from an expired minute/hour/day must not block a new window; own in `quota.test.ts` Task 3.
- Missing or malformed quota configuration: no limit is imposed and existing Evren calls continue; own in `quota.test.ts` Task 3.
- Usage endpoint timeout/abort: fetch returns null on network abort rather than throwing, except 401/403; own in `evrenUsage.test.ts` Task 2.
- Alternate invocation path: a direct exported invocation and the Pi registration path must share the same quota gate; own in `provider.test.ts` Task 4.

---

### Task 1: Establish Package and Source Layout

**Files:**
- Create: `package.json`
- Create: `src/evrenUsage.ts`
- Create: `src/quota.ts`
- Create: `src/provider.ts`
- Create: `src/index.ts`
- Create: `tests/evrenUsage.test.ts`
- Create: `tests/quota.test.ts`
- Create: `tests/provider.test.ts`

**Interfaces:**
- Consumes: repository's existing Evren source behavior from `/Users/lynicis/.omp/agent/extensions/evren-usage.ts` and package-free Node test runner.
- Produces: ESM package scripts `test`, `check`, and a default Pi extension export from `src/index.ts`.

- [ ] **Step 1: Create `package.json` with ESM and narrow scripts**

Define `type: "module"`, package name `pi-evren-provider`, private package status, scripts `test: "node --test tests/*.test.ts"` and `check: "npm test"`. Do not add runtime dependencies.

- [ ] **Step 2: Create one-line responsibility skeleton files**

Create `src/evrenUsage.ts`, `src/quota.ts`, `src/provider.ts`, and `src/index.ts`; no implementation or placeholder exports may remain after Task 4.

- [ ] **Step 3: Create empty test files named by the review paths**

Each file imports node:test and asserts its eventual behavior; this establishes no production logic before tests are written.

- [ ] **Step 4: Run setup check**

Run: `npm test`
Expected: test discovery fails because the skeletons expose no implementation, proving tests are not yet satisfied.

### Task 2: Port Evren Usage Fetcher Parity

**Files:**
- Create: `src/evrenUsage.ts`
- Test: `tests/evrenUsage.test.ts`

**Interfaces:**
- Consumes: `params: { baseUrl?: string; apiKey: string; signal?: AbortSignal }`, `ctx: { log?: (message: string) => void }`.
- Produces: `fetchEvrenUsage(params, ctx): Promise<EvrenUsage | null>` and exported helpers `toNumber`, `toTimestamp`, `amount`, `status`.

- [ ] **Step 1: Write success and limit mapping tests**

Assert a payload with `five_minute_remaining: 2`, `five_minute_limit: 10`, `reset_at`, `daily_remaining: 4`, `daily_limit: 8`, `daily_reset_at`, `concurrency_remaining: 1`, `concurrency_limit: 2`, and `level: "warning"` produces 5-minute/daily/concurrency limits, timestamps, warning/ok statuses, notes, metadata endpoint, and raw payload.

- [ ] **Step 2: Write null/throw behavior tests**

Assert network rejection returns null, HTTP 401 throws exactly `EVREN quota endpoint returned 401`, HTTP 403 throws exactly `EVREN quota endpoint returned 403`, HTTP 500 returns null, and invalid JSON or non-object JSON returns null.

- [ ] **Step 3: Implement source-port helpers and fetcher**

Port only the exact behavior recorded in the handoff: number parsing, timestamp parsing, amount selection, status thresholds, base normalization, quota endpoint call, headers, redirect, signal, logging, and result shape.

- [ ] **Step 4: Run parity tests**

Run: `node --test tests/evrenUsage.test.ts`
Expected: PASS for success shape and every null/throw case.

### Task 3: Implement Opt-In Static Quota Policy

**Files:**
- Create: `src/quota.ts`
- Test: `tests/quota.test.ts`

**Interfaces:**
- Consumes: `QuotaConfig = { requests?: number; inputTokens?: number; outputTokens?: number; window?: "minute" | "hour" | "day" }` and a clock `() => number`.
- Produces: `checkQuota(config, usage, nowMs?): QuotaCheckResult`, `recordQuotaUsage(config, usage): void`, and `createQuotaState(config, nowMs?): QuotaState`.
- Define `QuotaUsage = { requests: number; inputTokens: number; outputTokens: number }`; `QuotaCheckResult = { allowed: true } | { allowed: false; code: "EVREN_QUOTA_EXCEEDED"; limit: string; used: number; limitValue: number; resetsAt: number }`.

- [ ] **Step 1: Write boundary tests**

Assert request limit 5 allows usage 0 through 4 and rejects usage 5; input/output token limits independently reject at or above their configured values; omitted or zero limits remain disabled.

- [ ] **Step 2: Write window and malformed-config tests**

Assert minute/hour/day windows compute epoch-aligned `resetsAt`, a clock beyond the window starts a fresh state, and negative, non-finite, string, or unknown-window config values are treated as disabled for that dimension.

- [ ] **Step 3: Implement the state and deterministic window arithmetic**

Keep all accounting in memory, derive the window start from floor(now / windowMs), reset counters when the start changes, and never mutate provider config. Check before recording usage.

- [ ] **Step 4: Run quota tests**

Run: `node --test tests/quota.test.ts`
Expected: PASS for boundaries, rollover, and malformed/missing configuration.

### Task 4: Wire Pi Registration and Shared Invocation Gate

**Files:**
- Create: `src/provider.ts`
- Modify: `src/index.ts`
- Test: `tests/provider.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pi` as the Pi extension object, with `registerProvider(name, descriptor)` and an optional provider invoke function supplied by the concrete Pi API discovered during implementation.
- Produces: default `function registerEvrenProvider(pi): void`; `invokeEvren(input, quotaConfig): Promise<unknown>` in `src/provider.ts`; `EVREN_QUOTA_EXCEEDED` error shape.

- [ ] **Step 1: Write invocation-gate tests**

Assert a direct `invokeEvren` call and the Pi-registered callback are both denied before HTTP/provider work when the request limit is exhausted, both allow until the configured limit, and both record one request only after a successful provider result.

- [ ] **Step 2: Add usage registration and quota config lookup**

Register provider `evren` with the source-exact usage descriptor: `id: evren`, `cacheVersion: 1`, `usesRequestKey: true`, and `fetchEvrenUsage`.
If Pi exposes provider invocation callbacks, wrap each callback through `invokeEvren`; if it does not, document in the implementation that the existing core provider remains configuration-only and all repository-exposed invocation paths use `invokeEvren`. Do not add an unverified hook claim.

- [ ] **Step 3: Implement one shared gate**

Make `invokeEvren` call `checkQuota`, throw a plain error with `code`, `name: "EvrenQuotaExceededError"`, `limit`, `used`, `limitValue`, and `resetsAt` on denial, and reconcile input/output usage only after successful provider accounting is available. Never call the Evren HTTP request after denial.

- [ ] **Step 4: Run provider tests**
- Run: `node --test tests/provider.test.ts`
- Expected: PASS for direct and registered paths, deny-before-call, and success accounting.

### Task 5: Verify and Document the Plugin

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Document configuration and limits**

Write only the user-facing configuration keys, defaults-off behavior, window units, quota error code, and existing `models.yml` provider settings. State clearly that no external quota service is required.

- [ ] **Step 2: Run the complete narrow suite once**

Run: `npm test`
Expected: all Evren parity, quota, and provider invocation tests pass; no unrelated repository tests exist.

- [ ] **Step 3: Review the implementation diff once**

Check changed files against the spec: no provider behavior drift, no quota bypass path, and no dependency added outside Node built-ins. Fix only findings tied to these requirements.

- [ ] **Step 4: Commit authored changes selectively**

Run the repository's available selective commit flow rather than broad `git add`; include package metadata, source, tests, and README only.
