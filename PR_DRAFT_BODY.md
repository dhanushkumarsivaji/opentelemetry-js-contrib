## Description

Re: #3668

Brownfield reconciliation of `@opentelemetry/instrumentation-openai` with donated OpenInference GenAI coverage, adopting shared helpers from `@opentelemetry/genai-util` under the incremental export policy.

### Changes
- **genai-util:** export `TelemetryHandler`, invocation types, content-capture helpers, `getErrorType`, and GenAI semconv constants (superset of current `main` langchain exports).
- **instrumentation-openai:** depend on `@opentelemetry/genai-util@^0.4.0` for shared error classification / constants.
- Detect `gen_ai.provider.name` from OpenAI-compatible `baseURL` (Azure, Bedrock-only-when-`bedrock`+`amazonaws.com`, etc.; unknown hosts default to protocol `openai`).
- Record `gen_ai.usage.cache_read.input_tokens` / `gen_ai.usage.reasoning.output_tokens` only for positive finite values.
- Opt-in content capture: image parts recorded as `[image]` placeholder only (never raw / signed / `data:` URLs).
- Preserve public config, streaming, metrics, privacy defaults, and deprecated `gen_ai.system` on chat/embeddings for compatibility.

### Partial utility adoption (explicit)
This PR uses **selected** `genai-util` exports (`getErrorType`, semconv constants). It does **not** rewrite chat/embeddings/responses onto `TelemetryHandler` / full invocation lifecycle. Broader handler adoption is deferred.

### Not in this PR
- **#3667** (`APIPromise` / structured-output parse double-read) is a **separate** fix and is **not** duplicated or altered here.
- Full GenAI semantic-conventions **conformance** suite was **not** run in this environment; this PR does **not** claim full conformance.

### Release-order constraint
Published npm `@opentelemetry/genai-util@0.4.0` still ships an **empty** entry. Workspace / Unreleased exports the symbols this instrumentation imports. Please **release expanded `genai-util` before or together with** `@opentelemetry/instrumentation-openai` so out-of-tree installs resolve `getErrorType` and semconv symbols. Dependency range `^0.4.0` is intentional for monorepo/workspace compatibility.

### Commits (3)
1. `feat(genai-util): export public APIs for instrumentation consumers`
2. `feat(instrumentation-openai): adopt genai-util and donated GenAI gaps`
3. `fix(instrumentation-openai): address review privacy and attribution gaps`

AI assistance was used while drafting this change.

## Related Issues / PRs

Fixes #3668 (tracking / assignment).
Related: #3667 (separate; do not merge/alter here).

## Outstanding review questions
1. Is unknown OpenAI-compatible host → `gen_ai.provider.name=openai` (protocol default) acceptable, or should custom hosts omit / use a different value?
2. Confirm release-please should ship **genai-util export expansion before or with** instrumentation-openai.
3. Is `[image]` placeholder under opt-in capture the right privacy tradeoff vs omitting image parts entirely?
4. OK to keep deferred `TelemetryHandler` rewrite and leave #3667 independent?
