# Pi Evren Provider Plugin Design

## Intent and why
Convert the existing "evren" setup into a Pi AI provider plugin with behavior parity, and add quota support as a first-class capability.

Why: keep current evren behavior while exposing it through Pi’s provider plugin interface, and enforce usage limits safely.

## Goals
- Preserve current evren request/response behavior through the plugin interface.
- Keep configuration-driven runtime behavior (keys, model settings, endpoints, retries) aligned with evren.
- Add quota controls that can enforce request/token/period limits.
- Fail safely when quota is exceeded (clear error, no partial side effects).

## Non-goals
- Re-architecting evren internals beyond what plugin integration requires.
- Adding new model features not already in evren.
- Multi-tenant billing system design beyond quota enforcement hooks.

## Anti-goals
- Shipping a plugin that "works" but diverges from current evren behavior.
- Adding quota checks that can be bypassed on alternate call paths.
- Adding dependency-heavy infra when existing runtime/config patterns are enough.

## Constraints
- Current repository is empty, so implementation depends on importing or referencing the current evren source.
- Must follow existing conventions from the source setup once available.
- Keep the implementation boring and maintainable; avoid speculative abstractions.

## Approaches considered
1. **Source-port (selected)**
   - Directly convert existing evren setup into a Pi provider plugin.
   - Tradeoff: depends on access to the evren source location.
   - Why selected: strongest behavior parity and lowest regression risk.

2. **Spec-rebuild**
   - Recreate provider from high-level behavior description.
   - Tradeoff: high mismatch risk and hidden edge cases.
   - Rejected: parity is the priority.

3. **Scaffold-now, wire-later**
   - Build plugin skeleton first; integrate evren later.
   - Tradeoff: short-term progress, but likely rework and deferred correctness.
   - Rejected: adds churn before source parity work.

## High-level design
1. **Source import/mapping**
   - Identify evren entrypoints, request pipeline, provider config, and error model.
   - Map evren API surface to Pi provider plugin interface.

2. **Provider adapter layer**
   - Wrap evren invocation in Pi plugin contract.
   - Preserve input normalization and output formatting from evren.
   - Keep adapter thin: translation only, no business logic forks.

3. **Quota support**
   - Add a quota policy module enforced on every provider invocation path.
   - Quota dimensions:
     - request count limit
     - token/input-output unit limit (if evren exposes token accounting)
     - time-window limit (per minute/hour/day)
   - Behavior:
     - check before provider call for hard limits
     - optionally reconcile after call for usage-based accounting
     - deterministic "quota exceeded" error shape
   - Configuration:
     - defaults off unless explicitly configured
     - simple static config first (no external service required)

4. **Verification strategy**
   - Narrow checks only:
     - parity smoke test path against known evren behavior samples
     - quota allow/deny boundary checks
   - One focused run per changed behavior path.

## What is left to the builder
- Concrete file-level implementation depends on receiving the current evren source location.
- Once source is available, produce exact touchpoints list (adapter files, config, tests) and implement end-to-end.

## Open items requiring user input
- Exact location of the current evren setup to port (repo URL or local path).
- Quota policy defaults:
  - Which limits are mandatory from day one (requests, tokens, both)?
  - Default window and thresholds.
