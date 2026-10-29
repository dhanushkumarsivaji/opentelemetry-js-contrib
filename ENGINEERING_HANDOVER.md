# Engineering Handover: instrumentation-openai × genai-util (#3668)

**Status:** PR-ready implementation on feature branch (not opened upstream).  
**Assignee context:** @dhanushkumarsivaji on tracking issue [#3668](https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3668); maintainer @psx95 requested genai-util adoption while reconciling donated OpenInference coverage.  
**AI assistance:** This implementation and handover were prepared with an AI coding assistant (Composer). Human review of the diff, test results, and PR text before upstream submission is required per OpenTelemetry GenAI contribution policy.

## Branch and commits

| Item | Value |
| --- | --- |
| Branch | `cursor/instrumentation-openai-genai-util-20f0` |
| Base | `main` @ `d49c2fd5ac5a0758f9b1569e3f2ba7e8232ee912` |
| Upstream remote | `https://github.com/open-telemetry/opentelemetry-js-contrib.git` |
| Fork push | Blocked here (GitHub PAT lacks `fork` permission). Push this branch from a personal fork before opening the PR. |

Commits on this branch:

- `b0526a420ddd0cbe10204f526030f184f65b1819` feat(genai-util): export public APIs for instrumentation consumers
- `a99b9211f066f3433fc41665fe43a3436b23f5da` feat(instrumentation-openai): adopt genai-util and donated GenAI gaps

## Exact files changed

### `@opentelemetry/genai-util`

- `packages/genai-util/src/index.ts` — public exports
- `packages/genai-util/src/utils.ts` — comment clarifying export policy
- `packages/genai-util/README.md` — document current exports + minimal usage
- `packages/genai-util/CHANGELOG.md` — Unreleased notes
- `knip.jsonc` — remove temporary genai-util ignore override
- `scripts/verify-pack.mjs` — stop skipping genai-util now that it exports symbols

### `@opentelemetry/instrumentation-openai`

- `packages/instrumentation-openai/package.json` — depend on `@opentelemetry/genai-util@^0.4.0`
- `package-lock.json` — workspace dependency entry only
- `packages/instrumentation-openai/src/utils.ts` — provider detection + usage-detail helpers
- `packages/instrumentation-openai/src/instrumentation.ts` — adopt helpers; provider/usage/multimodal
- `packages/instrumentation-openai/test/utils.test.ts` — new unit coverage
- `packages/instrumentation-openai/test/openai.test.ts` — expect `gen_ai.provider.name`
- `packages/instrumentation-openai/README.md` / `CHANGELOG.md`

## Feature gap matrix (OTel vs donated OpenInference)

| Capability | Existing OTel package | Donated OpenInference | Action in this change |
| --- | --- | --- | --- |
| Chat / Embeddings / Responses | Covered (GenAI semconv) | Covered (OpenInference attrs) | Keep OTel; do not port OI attrs |
| Streaming robustness | Strong (tee, multi-choice, usage) | Weaker | Keep OTel |
| Metrics | Duration + token histograms | None | Keep OTel |
| Content capture default | Opt-in boolean + env `true/false` | Always-on / TraceConfig | Keep OTel privacy default |
| `gen_ai.provider.name` from host | Hardcoded `openai` (Responses); chat used deprecated `gen_ai.system` only | Rich hostname map | **Implemented** (GenAI enum values) |
| Cache / reasoning token details | Missing | Present as OI attrs | **Implemented** as GenAI attrs (omit zeros) |
| Chat multimodal image parts | Text-only when capturing | Image URL attrs | **Implemented** under opt-in capture |
| Legacy Completions API | Missing | Present (stream path incomplete) | Deferred |
| Tool JSON schema on request | Missing | Present (`llm.tools.*`) | Deferred (needs GenAI home) |
| `APIPromise` / `*.parse` double-read | Open bug [#3586](https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3586) | `_thenUnwrap` hardening | **Deferred — do not duplicate** open PR [#3667](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3667) |
| Full `TelemetryHandler` lifecycle | Local span/metric/event code | N/A | Deferred (metrics/events model differs) |
| TTFT / `wrapAsyncStream` | Missing | Missing | Deferred — depends on unmerged [#3831](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3831) |

## genai-util APIs adopted

**Exported in this change (merged package had empty `index.ts`):**

- `TelemetryHandler`, `TelemetryHandlerOptions`
- Types: `InferenceInvocation`, `EmbeddingInvocation`, `ToolInvocation`, `ContentCaptureMode`, `GenAIInstrumentationConfig`, invocation options, `TokenUsageDetails`, `InvocationError`, message types
- `ENV_GENAI_CAPTURE_MESSAGE_CONTENT`, `getContentCaptureMode`, `parseContentCaptureMode`
- `getErrorType`
- `export *` from `semconv`

**Actually consumed by instrumentation-openai today:**

- `getErrorType`
- Provider / usage semconv constants (`GEN_AI_PROVIDER_NAME_VALUE_*`, `ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS`, `ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS`)

**Intentionally not wired yet:**

- `TelemetryHandler` span lifecycle (would change metric names / event model; chat still emits deprecated per-role log events)
- `getContentCaptureMode` (genai-util maps legacy env `true` → `none`; openai documents boolean `true`/`false` — switching would break capture)

## Changes implemented

1. Public genai-util export surface so instrumentations can depend on stable symbols.
2. openai package depends on genai-util and uses `getErrorType` for `error.type`.
3. Hostname → `gen_ai.provider.name` detection (Azure OpenAI, Azure AI Inference, Anthropic, Cohere, Mistral, GCP, Bedrock, xAI, DeepSeek, Groq, Moonshot, Perplexity; default `openai`).
4. Chat + embeddings spans now set `gen_ai.provider.name` while retaining deprecated `gen_ai.system=openai` for compatibility.
5. Cache-read / reasoning usage attributes when detail counts are `> 0`.
6. Opt-in chat content capture includes image URLs (and refusal text) instead of stripping non-text parts.

## Intentionally deferred

- Full `TelemetryHandler` migration for chat/embeddings/responses
- Content-capture mode uplift (`none`/`span_only`) while preserving boolean env compatibility
- Legacy Completions (`text_completion`) instrumentation
- Tool-definition / JSON-schema capture
- TTFT metrics / `wrapAsyncStream` (unmerged upstream)
- Any overlap with [#3667](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3667) (`*.parse` body double-read)
- Conformance suite wiring against `semantic-conventions-conformance` (not run in this environment)
- Bedrock conformance project (untouched per instructions)

## Test commands and results

Environment: Node `v22.23.4`, npm `10.9.9` (repo warns it prefers Node ≥24.11.1 / npm ≥11.10.0).

| Command | Result |
| --- | --- |
| `npx nx run @opentelemetry/genai-util:compile` | **PASS** |
| `npx nx run @opentelemetry/instrumentation-openai:compile` | **PASS** |
| `npm test -w @opentelemetry/genai-util` | **PASS** — 152 tests |
| `npm test -w @opentelemetry/instrumentation-openai` | **PASS** — 63 tests (includes new utils cases) |
| `npx nx run @opentelemetry/genai-util:lint` | **PASS** |
| `npx nx run @opentelemetry/instrumentation-openai:lint` | **PASS** (2 pre-existing warnings in untouched `responses.ts`) |
| `npx nx run …:lint:readme` (both packages) | **PASS** |
| Monorepo-wide `npm run lint` / `test-all-versions` / conformance | **Not run** (full monorepo lint/TAV not executed here) |

## Semantic convention compliance

- No claim of full GenAI conformance suite passage.
- Unit/integration fixtures assert GenAI attribute names (`gen_ai.*`), not OpenInference (`llm.*`).
- Chat Completions still emit deprecated `gen_ai.system` and legacy message events for compatibility; Responses already uses modern provider + inference.details events.
- Cache/reasoning attribute names match genai-util / current GenAI draft constants.

## Compatibility and regression risks

| Risk | Notes |
| --- | --- |
| Extra span/metric attribute `gen_ai.provider.name` on chat/embeddings | Additive; exact-match dashboards/tests need updates (package tests updated). |
| `error.type` via `getErrorType` | Prefers `error.code` then `name`; connection-error fixtures still expect `APIConnectionError` and passed. |
| Zero usage details omitted | Avoids noisy `0` attrs when OpenAI returns empty detail objects. |
| Public config unchanged | `captureMessageContent?: boolean` preserved. |
| Conflict with #3667 | This branch does not touch APIPromise observation; rebase carefully if both land. |

## Dependencies on unmerged upstream work

| Work | State | Impact |
| --- | --- | --- |
| genai-util core (handler/invocations) | **Merged** on main (`0.4.0`) | Used |
| Public exports | **Were empty**; this PR adds them | Required for adoption |
| [#3831](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3831) `wrapAsyncStream` | Open | Needed for TTFT follow-up |
| [#3698](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3698) anthropic demo adoption | Draft / demo | Pattern reference only; API shapes differ from merged handler |
| [#3667](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3667) parse double-read fix | Open | Do not duplicate |

## Proposed PR title and body

**Title:** `feat(instrumentation-openai): adopt genai-util and port donated provider/usage coverage`

**Body (draft for human polish before submit):**

```markdown
## Which problem is this PR solving?

Re: #3668

Reconcile `@opentelemetry/instrumentation-openai` with donated OpenInference coverage and begin shared `@opentelemetry/genai-util` adoption, as requested on the tracking issue. This is an incremental brownfield change: it does not replace the existing package and does not port OpenInference attribute names.

## Short description of the changes

- Export the stable genai-util surface needed by instrumentations (`TelemetryHandler`, types, content-capture helpers, `getErrorType`, semconv).
- Depend on `@opentelemetry/genai-util` from instrumentation-openai.
- Detect `gen_ai.provider.name` from OpenAI-compatible base URLs (including Azure).
- Record cache-read / reasoning usage detail attributes when present and non-zero.
- Include image URLs in opt-in chat content capture.
- Preserve public config, streaming behavior, metrics, and privacy defaults.

## Important Info

- Does **not** address #3586 / overlap #3667 (APIPromise parse double-read).
- Full `TelemetryHandler` lifecycle migration and content-capture mode uplift are intentionally deferred (see ENGINEERING_HANDOVER.md).
- AI assistance was used while drafting this change; the author reviewed the implementation and local test results.

## Checklist

- [x] Linked #3668
- [x] Unit tests updated/passing for touched paths
- [x] Build/lint for touched packages
- [ ] Upstream CI / TAV
- [ ] Conformance suite (follow-up)
```

## Measured technical value

- First in-tree consumer of `@opentelemetry/genai-util` public exports (unblocks other GenAI instrumentations).
- Closes concrete donated gaps that map cleanly to GenAI semconv (provider detection, usage details, multimodal capture) without rewriting the package.
- Avoids speculative attributes and avoids conflicting with in-flight #3667.

## Recommended subsequent contributions

1. Coordinate with #3667 authors; land parse fix without overlapping this branch.
2. Content-capture compatibility layer: accept env `true`/`false` **and** `span_only`/`none`, then adopt `getContentCaptureMode`.
3. Incremental `TelemetryHandler` adoption starting with embeddings (simplest path) while preserving chat event compatibility.
4. Legacy Completions (`text_completion`) with OTel-quality streaming.
5. TTFT after #3831 merges.
6. Wire GenAI semantic-conventions conformance scenarios for openai chat/responses.

## How to open the upstream PR

```bash
# from a machine with fork permission
gh repo fork open-telemetry/opentelemetry-js-contrib --remote-name fork
git remote add fork git@github.com:<you>/opentelemetry-js-contrib.git
git push -u fork cursor/instrumentation-openai-genai-util-20f0
gh pr create --repo open-telemetry/opentelemetry-js-contrib \
  --base main \
  --head <you>:cursor/instrumentation-openai-genai-util-20f0 \
  --title "feat(instrumentation-openai): adopt genai-util and port donated provider/usage coverage" \
  --body-file ENGINEERING_HANDOVER.md   # or paste the draft body above
```

Do not force-push other contributors' branches. Do not merge upstream from this session.
