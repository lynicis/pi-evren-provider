# Evren Native Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one npm package to use Evren in Pi and OMP with native login, model discovery, Responses, and logout.

**Architecture:** Share the fixed Evren endpoint, auth probe, and catalog projection. Pi registers a native provider object; OMP loads the existing npm entry with a full OMP descriptor and its existing usage hook. The hosts, not the package, own credential persistence and the catalog lifecycle.

**Tech Stack:** TypeScript, Node `node:test`, Pi `@earendil-works/pi-ai/compat`, OMP extension API, standard Fetch.

**Spec:** `docs/superpowers/specs/2026-11-26-evren-native-provider-design.md`

## Global Constraints

- Provider `evren`, display name `Evren`, base URL `https://evren-llmapi.ssyz.org.tr/v1`, transport `openai-responses`.
- First smoke targets: Pi `1.6.1` and OMP `19.2.1`. No live secrets in code, test data, logs, or tool transcripts.
- No manual models file or env var required, no key fallback, no custom auth commands, and no changes to the existing direct quota API. No publish or user configuration edits.
- Write changed assertions before the implementation; run each narrow gate once after the last edit (no intermediate test run). Do not create commits unless requested.

## Review Focus

- Invalid key and 5xx/transport failures must not persist credentials or leak details: task 1.
- Cancelled or timed-out credential probes must terminate in-flight HTTP: task 1.
- Transient and malformed list responses must not clear the successful catalog; explicit `data: []` must clear it: tasks 1–2.
- An API-key string returned from OMP must work for both discovery and usage, not as an OAuth token: task 2.
- Expired sessions, logout and stale config overrides must not masquerade as proof that native auth worked: task 3.

---

### Task 1: Shared Evren HTTP and catalog

**Files:** Create `src/evren.ts`, `tests/evren.test.ts`.

**Interfaces:** `EVREN_BASE_URL`; `validateEvrenKey(apiKey: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<string>`; `fetchEvrenModels(apiKey: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<EvrenModel[]>`. `EvrenModel` is a text-chat catalog row with `id`, `name`, `input: ['text']`, numeric `contextWindow`, `maxTokens`, and four zero-valued `cost` fields; mark reasoning false in Pi, leave it unspecified in OMP rather than inventing capability metadata.

- [ ] Define HTTP tests with an injected `fetcher`. Assert login returns the trimmed synthetic key after a 2xx `GET …/v1/quota`, passes the key in `Authorization: Bearer …`, rejects redirects, and posts no inference. Blank input and a pre-aborted signal must make zero requests. Assert 401/403 reject with `Evren rejected the API key`, 5xx rejects with an HTTP-status diagnostic, and a thrown transport error containing a synthetic marker is not propagated in the error message or cause. Assert aborting the caller's signal aborts the fetch; in a separate test stub `AbortSignal.timeout` locally, assert the requested timeout is `10_000`, and abort that signal to prove it also cancels fetch without waiting in real time.
- [ ] Define discovery tests: for `{data:[{id:'tenant/gpt-new',max_model_len:8192,max_completion_tokens:16384},{id:'tenant/gpt-new'},{},{id:'tenant/gpt-other'}]}`, assert exact IDs `['tenant/gpt-new','tenant/gpt-other']`, first limits `[8192,8192]`, second limits `[32768,4096]`, and the Bearer key goes only to `GET …/v1/models`. Assert `{data:[]}` succeeds empty; malformed JSON, missing `data`, a nonempty list with no valid ids, and HTTP failure reject.
- [ ] Implement one internal authenticated GET for the two fixed relative routes. Use `Accept: application/json`, `redirect: 'error'`; combine caller cancellation and a `10_000` ms request deadline, including body reads. Do not copy request headers, response text, or transport exceptions into diagnostics. Cancel the probe response body without reading it. Accept nonempty string IDs verbatim, keep the first valid occurrence of each, and read positive safe integers in order: `max_model_len` then `context_length` for context; `max_completion_tokens` then `max_tokens` for output. Use `32768`/`4096` when absent, cap output at context size, use `name = id`, and do not infer prices or extra modalities.

### Task 2: Wire Pi and OMP without a custom store

**Files:** Create `src/pi.ts` and `tests/pi-provider.test.ts`; modify `src/provider.ts:1-3,41-52`, `tests/provider.test.ts:40-48`, `package.json`, and `package-lock.json`. Preserve the default entry in `src/index.ts`.

**Interfaces:** `src/pi.ts` default `registerEvrenPiProvider(pi: { registerProvider(provider: Provider<'openai-responses'>): unknown }): void`; `src/provider.ts` keeps the existing `createEvrenProvider(pi: { registerProvider(name: string, descriptor: unknown): unknown }): void` signature as the OMP factory. Both consume task 1's functions. Only the Pi entry imports the Pi SDK at runtime.

- [ ] Add Pi tests through the real `createModels` registry and a temporary/in-memory credential store. Assert that the native interaction gets a `{type:'secret', message:'Evren API key'}` prompt; `login` records `{type:'api_key',key:'test-key'}` after the probe; a mock list with `tenant/gpt-new` becomes selectable. Stream that model through the registry with a synthetic Fetch response and assert `POST …/v1/responses` bears the saved key and selects `tenant/gpt-new`. Assert `/logout`'s registry operation leaves no usable model. On a failed refresh the known model remains; on a valid empty refresh it is removed. Never touch the user's store.
- [ ] Replace the usage descriptor shape smoke assertion with an OMP callback behavior test. Assert `oauth.login` invokes `onPrompt({message:'Evren API key',secret:true})`, returns the validated key string, and rejects invalid/cancelled login. `fetchDynamicModels(undefined)` makes no HTTP request; the string returned by login fetches the synthetic catalog, and the registered `usage.fetchUsage` uses the same string as its request key for `/v1/quota`. A discovery failure rejects rather than returning a successful empty catalog. Keep the two direct `invokeEvren` quota tests unchanged.
- [ ] In `src/pi.ts`, import `createProvider`, `openAIResponsesApi` and `Provider` from `@earendil-works/pi-ai/compat`. Create the provider with `auth.apiKey.name: 'Evren API key'`, `login` returning `{ type: 'api_key', key }` after the masked prompt and shared key probe with `interaction.signal`, and `resolve` returning `{ auth: { apiKey: credential.key }, source: 'stored API key' }` only when the host supplies a key. Start with `models: []` and `api: openAIResponsesApi()`. `fetchModels` uses the network refresh context's effective API-key credential and `signal`. Map rows to Pi `Model<'openai-responses'>` with `provider: 'evren'`, `api: 'openai-responses'`, the fixed `baseUrl`, and `reasoning: false`. Use `createProvider`'s native generation-checked catalog publication; do not invent cache files.
- [ ] In `src/provider.ts`, expand the OMP `registerProvider('evren', …)` descriptor with `baseUrl`, `api: 'openai-responses'`, `authHeader: true`, `oauth.name: 'Evren'`, and `oauth.login`. Pass `callbacks.signal` and `callbacks.fetch` to the shared key probe, return the plain validated string, and do not define OAuth refresh/getters or an `apiKey` fallback. `fetchDynamicModels` returns the shared rows with the host-resolved key, or `[]` without making a request when there is no key. Keep the `usage` descriptor and existing `fetchEvrenUsage`. OMP's generic Responses route on this custom endpoint does not request native compaction by default; do not add a `models.yml` override.
- [ ] Set `package.json` `pi.extensions` to `["./src/pi.ts"]` and `omp.extensions` to `["./src/index.ts"]`; keep the npm default export and `files` whitelist. Add `@earendil-works/pi-ai` `1.6.1` as a development dependency for the real Pi registry test, updating the lockfile; Pi supplies the documented compatibility import when it loads the extension. No production OMP dependency.

### Task 3: Installed package and native CLI proof

**Files:** Modify `README.md:1-48,99-112`.

- [ ] Replace manual setup with `pi install npm:pi-evren-provider` and `omp plugin install pi-evren-provider`, `/login evren`, `/model`, and `/logout`. Explain that previous users should remove only the old Evren provider stanza and restart before logging in, that logout is local, and that OMP's `/usage` uses Evren's quota endpoint. Keep direct quotas explicitly separate from normal chat. List host versions only after checking them; do not imply the old npm release has these features.
- [ ] Run `node --test tests/evren.test.ts tests/pi-provider.test.ts tests/provider.test.ts tests/evrenUsage.test.ts`. Check the tarball file list once with `npm pack --dry-run`; it must contain both declared entry points and their relative imports.
- [ ] Use two temporary agent directories (`PI_CODING_AGENT_DIR`), with no user settings, and test the checkout via `pi install /absolute/path/to/checkout` and `omp plugin link /absolute/path/to/checkout`. In the actual TUIs confirm `/login evren` opens a masked prompt and cancelling leaves no usable Evren auth or model. Confirm an invalid synthetic key is rejected if the fixed endpoint is reachable. Where an authorized user enters a valid key privately, verify exact catalog membership, one completion, auth on restart, removal via `/logout`, and OMP `/usage`. If that key or network access is unavailable, record the unverified live checks separately from the synthetic tests. Never route the user's keystrokes through a capture that records the key.

## Parallel waves

One integrated cutover: common HTTP, host adapters, packaging, and docs. Run the gate after all edits.

```json
[
  {
    "id": "evrenNativeProvider",
    "agent": "generic-coding-agent",
    "owns": ["[NEW] src/evren.ts", "[NEW] src/pi.ts", "[NEW] tests/evren.test.ts", "[NEW] tests/pi-provider.test.ts", "src/provider.ts", "tests/provider.test.ts", "package.json", "package-lock.json", "README.md"],
    "reads": ["src/index.ts", "src/evrenUsage.ts", "docs/superpowers/specs/2026-11-26-evren-native-provider-design.md"],
    "symbols": [{"path": "src/provider.ts", "name": "createEvrenProvider", "signature": "export function createEvrenProvider(pi: { registerProvider(name: string, descriptor: unknown): unknown; }): void"}],
    "invariants": ["Both host stores own credentials", "No hardcoded catalog IDs", "Preserve the OMP usage hook and direct quota behavior"],
    "tests": ["tests/evren.test.ts", "tests/pi-provider.test.ts", "tests/provider.test.ts", "tests/evrenUsage.test.ts"],
    "acceptance": "Both package entries load in isolated hosts, native masked login is available, and targeted behavior tests pass.",
    "coupling": "The two manifest entry points and shared helper must land together to make the tarball installable without manual provider configuration."
  }
]
```
