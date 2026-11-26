# Evren as a native-login provider package

## Goal

Install `pi-evren-provider` once in Pi or Oh My Pi (OMP). Use `/login evren`, choose an Evren model from `/model`, and use `/logout` to remove the credential. Do not require `models.json`, `models.yml`, an environment variable, or a separate Evren command or credential store.

## Approaches

- **Selected: one npm package, two host entry points.** Both clients load their own adapter straight from the package manifest. The adapters share Evren HTTP and catalog mapping code, not host internals. The package is independently installable; it does not need a host release.
- **Rejected: upstream built-in provider in both clients.** Removes the package install but needs two core changes and release cycles. The user chose package installation instead.
- **Rejected: keep the usage extension and require a manual provider stanza.** Leaves connection setup and key precedence to the user, and does not deliver the selected experience.

## Behavior

- Both hosts register provider ID `evren`, display name `Evren`, and use `https://evren-llmapi.ssyz.org.tr/v1`. Login requests masked input and verifies the submitted key by an authenticated, non-inference `GET /v1/quota` before returning it to the host. Blank input, cancellation and failed verification do not persist a key. Diagnostics must not contain the submitted key, response body, or raw transport error. The package sends keys only to the fixed Evren origin and rejects redirects on the validation and catalog requests it owns.
- Pi uses native `apiKey.login`/`resolve` and the host `auth.json`; OMP uses the extension provider's string-returning `oauth.login`, which stores a native API-key row in `agent.db` or the configured auth backend. The package supplies no key fallback. `/logout` removes the host credential, not the server key. An old manual Evren override is migrated by the user, never edited by the package.
- Discover the exact returned model IDs at authenticated `GET /v1/models`. No hardcoded IDs. Publish through the native catalog paths; failed refreshes must not replace the last successful catalog; a valid empty catalog is not an error. An unauthenticated provider supplies no usable Evren models. Models use the hosts' `openai-responses` adapter. OMP still reports `/v1/quota` usage through its existing usage hook. The direct process-local `invokeEvren` helper remains unchanged and is not a chat middleware.
- Compatibility targets for the first verification: Pi `1.6.1` and OMP `19.2.1`. Claim support only for host versions actually exercised. The package does not publish, modify users' installed configurations, or add a new credential mechanism as part of implementation.

## Done when

Both host package loaders find Evren without a manually configured provider. In each host, successful masked `/login evren` makes the returned catalog selectable; a restart uses stored auth; a completion uses Responses; `/logout` removes usable auth, including after restart. An invalid key is not saved. In OMP `/usage` continues to work with the same stored key. Tests use synthetic credentials. Record any real-service smoke step that could not run without a user-supplied key as unverified; never collect that key in chat or logs.
