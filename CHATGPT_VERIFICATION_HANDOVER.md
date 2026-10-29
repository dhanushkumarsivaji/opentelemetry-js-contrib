# ChatGPT Verification Handover

**Purpose of this document:** Give ChatGPT (or any reviewer) everything needed to independently verify the OpenTelemetry JS Contrib contribution for `instrumentation-openai` / `#3668`. Treat every claim below as checkable. Flag any claim that cannot be verified from the listed evidence.

**Do not trust narrative alone.** Prefer: git history → file diff → tests → this document’s “Non-claims” section.

---

## 0. Prompt you can paste into ChatGPT

```text
You are verifying an OpenTelemetry JavaScript Contrib contribution.
Use only the evidence in this handover and any files/diffs I attach.
Do not invent test results, PR numbers, or compliance outcomes.

Task:
1. Verify each CHECKABLE CLAIM as PASS / FAIL / INCONCLUSIVE with evidence.
2. List any exaggerated, unverifiable, or contradictory claims.
3. Assess merge readiness for a brownfield PR against opentelemetry-js-contrib#3668.
4. Call out risks around #3667 overlap, privacy defaults, breaking telemetry changes, and unmerged genai-util APIs.
5. End with a short verdict: Ready / Ready with fixes / Not ready.

Handover follows.
```

---

## 1. Assignment context (verify against GitHub)

| Fact | Value | How to verify |
| --- | --- | --- |
| Tracking issue | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3668 | Open issue; assignee table lists `instrumentation-openai` → `@dhanushkumarsivaji` |
| Maintainer guidance | `@psx95` assigned package and asked to update it to use shared genai-util | Issue comment thread ~2026-10-27 |
| Existing-package rule | Do not re-port from scratch; analyze delta vs donation; contribute missing/improved pieces | Issue “Existing Packages” under Migration Guidelines |
| Donation source | https://github.com/open-telemetry/donation-openinference (not Arize repo) | Issue IMPORTANT note |
| Related util issue | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3681 | genai-util feature request |
| Open bug NOT fixed here | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3586 | parse / Body already read |
| Open PR NOT duplicated | https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3667 | APIPromise double-read fix by another author |
| Unmerged stream helper | https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3831 | `wrapAsyncStream` |
| Anthropic demo adoption PR | https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3698 | draft; pattern only |
| Upstream PR from this work | **Not created** (explicit instruction) | No PR link claimed |

---

## 2. Branch identity (checkable)

| Item | Value |
| --- | --- |
| Branch name | `cursor/instrumentation-openai-genai-util-20f0` |
| Upstream base | `main` @ `d49c2fd5ac5a0758f9b1569e3f2ba7e8232ee912` |
| Upstream repo | `https://github.com/open-telemetry/opentelemetry-js-contrib.git` |
| Commit 1 | `b0526a420ddd0cbe10204f526030f184f65b1819` — `feat(genai-util): export public APIs for instrumentation consumers` |
| Commit 2 | `a99b9211f066f3433fc41665fe43a3436b23f5da` — `feat(instrumentation-openai): adopt genai-util and donated GenAI gaps` |
| Tip SHA | `a99b9211f066f3433fc41665fe43a3436b23f5da` |
| Diffstat vs base | 14 files, +469 / −38 |
| Local artifact | `instrumentation-openai-genai-util-20f0.bundle` (git bundle of the two commits) |
| Fork push status | Failed in authoring environment (`HTTP 403` fork permission). Branch is local + bundle; not on GitHub fork yet. |

### How to load the branch for verification

```bash
git clone https://github.com/open-telemetry/opentelemetry-js-contrib.git
cd opentelemetry-js-contrib
git fetch /path/to/instrumentation-openai-genai-util-20f0.bundle \
  cursor/instrumentation-openai-genai-util-20f0:cursor/instrumentation-openai-genai-util-20f0
git checkout cursor/instrumentation-openai-genai-util-20f0
git log --oneline d49c2fd5ac5a0758f9b1569e3f2ba7e8232ee912..HEAD
# expect exactly the two commits above
```

---

## 3. Exact files changed (must match `git diff --name-only`)

### Package `@opentelemetry/genai-util`

1. `packages/genai-util/src/index.ts`
2. `packages/genai-util/src/utils.ts`
3. `packages/genai-util/README.md`
4. `packages/genai-util/CHANGELOG.md`
5. `knip.jsonc`
6. `scripts/verify-pack.mjs`

### Package `@opentelemetry/instrumentation-openai`

7. `packages/instrumentation-openai/package.json`
8. `package-lock.json` (only the openai → genai-util dependency entry)
9. `packages/instrumentation-openai/src/utils.ts`
10. `packages/instrumentation-openai/src/instrumentation.ts`
11. `packages/instrumentation-openai/test/utils.test.ts`
12. `packages/instrumentation-openai/test/openai.test.ts`
13. `packages/instrumentation-openai/README.md`
14. `packages/instrumentation-openai/CHANGELOG.md`

**Scope guardrail:** no other instrumentation packages modified; Bedrock conformance project untouched.

---

## 4. CHECKABLE CLAIMS

For each claim, ChatGPT should answer **PASS / FAIL / INCONCLUSIVE** and cite evidence.

### A. genai-util export surface

| ID | Claim | Evidence to inspect |
| --- | --- | --- |
| A1 | Before this branch, `packages/genai-util/src/index.ts` exported nothing (`export {}` / empty public surface). | Compare parent commit `d49c2fd5` vs commit 1. |
| A2 | After commit 1, index exports `TelemetryHandler`, invocation **types**, content-capture helpers, `getErrorType`, and `export *` from `semconv`. | `packages/genai-util/src/index.ts` |
| A3 | Invocation classes are exported as `export type` only (no public constructors bypassing handler). | same file |
| A4 | `knip.jsonc` temporary genai-util ignore block was removed. | `knip.jsonc` |
| A5 | `scripts/verify-pack.mjs` no longer skips `@opentelemetry/genai-util`. | `SKIP_PACKAGES` |

### B. instrumentation-openai adoption

| ID | Claim | Evidence to inspect |
| --- | --- | --- |
| B1 | `package.json` adds dependency `"@opentelemetry/genai-util": "^0.4.0"`. | `packages/instrumentation-openai/package.json` |
| B2 | Runtime import of `getErrorType` from `@opentelemetry/genai-util` exists. | `src/instrumentation.ts` import + rejection handler |
| B3 | Public config remains `captureMessageContent?: boolean` (not forced to ContentCaptureMode). | `src/types.ts` unchanged shape |
| B4 | Content capture remains opt-in / default off; env still uses boolean `true`/`false` via local `getEnvBool`. | constructor in `instrumentation.ts`; README |
| B5 | `getContentCaptureMode` from genai-util is **not** used (because genai-util maps env `true` → `none`). | grep package for `getContentCaptureMode` → expect no usage |
| B6 | `TelemetryHandler` is exported by genai-util but **not** used to drive openai span lifecycle in this change. | grep openai package for `TelemetryHandler` → expect no usage |

### C. Donated-gap ports (GenAI-mapped only)

| ID | Claim | Evidence to inspect |
| --- | --- | --- |
| C1 | `getProviderNameFromBaseURL` maps known hosts to GenAI provider enums (incl. Azure) and defaults to `openai`. | `src/utils.ts` `HOST_SUFFIX_TO_PROVIDER` |
| C2 | Chat + embeddings spans set `gen_ai.provider.name` **and** still set deprecated `gen_ai.system=openai`. | `_startChatCompletionsSpan`, `_startEmbeddingsSpan` |
| C3 | Responses uses detected provider name (not only hardcoded openai). | `_startResponsesSpan` |
| C4 | `setUsageDetailAttributes` sets `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.reasoning.output_tokens` only when value is a number **and `> 0`**. | `src/utils.ts` |
| C5 | Usage-detail helper is called from chat non-stream, chat stream usage chunk, responses non-stream, responses stream completed. | `instrumentation.ts` call sites |
| C6 | Under content capture, chat message content formatting includes image URLs (and refusal text), not text-only filter. | `formatChatMessageContent` |
| C7 | No OpenInference attribute names (`llm.*`, `openinference.span.kind`, `input.value`) were introduced. | grep diff for `llm.` / `openinference` → expect none in production code |

### D. Explicit non-overlap / deferred work

| ID | Claim | Evidence to inspect |
| --- | --- | --- |
| D1 | This branch does **not** implement the APIPromise / `*.parse` double-read fix. | no changes resembling #3667 observer/`parseResponse` wrapping |
| D2 | Legacy Completions API is still not instrumented. | `init()` still only wraps Chat.Completions, Embeddings, Responses |
| D3 | No TTFT / `wrapAsyncStream` dependency. | no import of unmerged stream helper |
| D4 | Bedrock conformance project untouched. | out of repo scope; not in file list |

### E. Tests and quality gates (author-reported; re-run to confirm)

Author environment: Node `v22.23.4`, npm `10.9.9` (repo prefers newer Node/npm; treat as possible variance).

| ID | Claim | Command | Author-reported result |
| --- | --- | --- | --- |
| E1 | genai-util compiles | `npx nx run @opentelemetry/genai-util:compile` | PASS |
| E2 | openai compiles | `npx nx run @opentelemetry/instrumentation-openai:compile` | PASS |
| E3 | genai-util unit tests | `npm test -w @opentelemetry/genai-util` | **152 passing** |
| E4 | openai package tests | `npm test -w @opentelemetry/instrumentation-openai` | **63 passing** |
| E5 | package eslint | `npx nx run @opentelemetry/genai-util:lint` / `...instrumentation-openai:lint` | PASS; openai has **2 pre-existing warnings** in untouched `responses.ts` |
| E6 | readme lint | `npx nx run …:lint:readme` both packages | PASS |
| E7 | Full monorepo lint | `npm run lint` | **Not run** |
| E8 | test-all-versions (TAV) | package `test-all-versions` | **Not run** |
| E9 | semantic-conventions-conformance | external conformance suite | **Not run** |

**Critical instruction for ChatGPT:** If tests were not re-run in the verification session, mark E1–E6 as **INCONCLUSIVE (author-reported)** rather than PASS.

---

## 5. Feature gap matrix (donation vs existing)

Source A: existing `@opentelemetry/instrumentation-openai` on main.  
Source B: donated `donation-openinference` package `openinference-instrumentation-openai`.

| Capability | Existing OTel | Donated OpenInference | This branch |
| --- | --- | --- | --- |
| Chat / Embeddings / Responses | Yes (GenAI) | Yes (OI attrs) | Keep OTel |
| Streaming robustness | Stronger | Weaker | Keep OTel |
| Metrics | Yes | No | Keep OTel |
| Privacy default | Opt-in | Often always-on | Keep opt-in |
| Provider from hostname | Partial / hardcoded | Rich map | **Done** (GenAI enums) |
| Cache/reasoning token details | No | Yes (OI names) | **Done** (GenAI names; omit zeros) |
| Chat multimodal images | Text-only on capture | Image attrs | **Done** (URLs under capture) |
| Completions API | No | Yes (stream incomplete) | Deferred |
| Tool JSON schemas | No | Yes (`llm.tools.*`) | Deferred |
| `*.parse` hardening | Bug #3586 | Has helper | Deferred → #3667 |
| TelemetryHandler lifecycle | Local code | N/A | Deferred |
| TTFT | No | No | Deferred → #3831 |

---

## 6. genai-util APIs: exported vs consumed

### Exported by this branch

- `TelemetryHandler`, `TelemetryHandlerOptions`
- `export type` for `InferenceInvocation`, `EmbeddingInvocation`, `ToolInvocation`
- Types: `ContentCaptureMode`, `GenAIInstrumentationConfig`, invocation options, `TokenUsageDetails`, `InvocationError`, message types
- `ENV_GENAI_CAPTURE_MESSAGE_CONTENT`, `getContentCaptureMode`, `parseContentCaptureMode`
- `getErrorType`
- all `semconv` constants via `export *`

### Consumed by instrumentation-openai in this branch

- `getErrorType`
- GenAI provider enum constants + usage attribute constants from genai-util `semconv`

### Exported but not consumed yet (intentional)

- `TelemetryHandler` lifecycle
- `getContentCaptureMode` / mode-based capture

---

## 7. Compatibility / regression risks (must acknowledge)

1. **Additive attribute** `gen_ai.provider.name` on chat/embeddings spans and related metrics attributes → exact-match consumers break unless updated (package tests were updated).
2. **`error.type` source change** to `getErrorType` (prefers `error.code`, then `name`, then constructor). Connection-error fixtures still expected `APIConnectionError` and author-reported they passed; re-verify.
3. **Zero usage details omitted** → spans won’t show `0` cache/reasoning attrs even if API returns zeros.
4. **Public API** of openai instrumentation config unchanged.
5. **Rebase risk** with open PR #3667 on the same package.

---

## 8. Non-claims (ChatGPT must reject if asserted)

Mark **FAIL** if the contribution or a human claims any of the following without new evidence:

1. “Fully migrated to TelemetryHandler.”
2. “Passes GenAI semantic-conventions conformance suite.”
3. “Fixes #3586 / structured output parse body already read.”
4. “Includes Completions API instrumentation.”
5. “Uses wrapAsyncStream / records TTFT.”
6. “Adopted getContentCaptureMode / span_only modes end-to-end.”
7. “Upstream PR already opened/merged.”
8. “Monorepo-wide lint / TAV all green in this session.”
9. Any performance benchmark numbers (none were measured).
10. Ported OpenInference `llm.*` attributes into OTel spans.

---

## 9. Proposed upstream PR (not opened)

**Title:**  
`feat(instrumentation-openai): adopt genai-util and port donated provider/usage coverage`

**Body draft:**

```markdown
## Which problem is this PR solving?

Re: #3668

Reconcile `@opentelemetry/instrumentation-openai` with donated OpenInference coverage and begin shared `@opentelemetry/genai-util` adoption. Brownfield change only: does not replace the existing package; does not port OpenInference attribute names.

## Short description of the changes

- Export stable genai-util public APIs needed by instrumentations.
- Depend on `@opentelemetry/genai-util` from instrumentation-openai.
- Detect `gen_ai.provider.name` from OpenAI-compatible base URLs.
- Record cache-read / reasoning usage details when non-zero.
- Include image URLs in opt-in chat content capture.
- Preserve public config, streaming, metrics, and privacy defaults.

## Important Info

- Does not address #3586 / does not overlap #3667.
- Full TelemetryHandler lifecycle migration deferred.
- AI assistance was used while drafting; author must review before submit.
```

---

## 10. Measured technical value (keep modest)

- First in-tree consumer path for genai-util **public** exports (package previously exported nothing).
- Closes three concrete donated gaps that map to GenAI semconv without a rewrite.
- Avoids conflicting with in-flight #3667.

Not claimed: production traffic validation, conformance certification, or complete genai-util adoption.

---

## 11. Recommended follow-ups (ordered)

1. Land/rebase around #3667 without duplicating it.
2. Content-capture compatibility: accept env `true`/`false` **and** `span_only`/`none`, then adopt `getContentCaptureMode`.
3. Incremental TelemetryHandler adoption starting with embeddings.
4. Legacy Completions with correct streaming.
5. TTFT after #3831 merges.
6. Wire GenAI conformance scenarios for openai.

---

## 12. Verification checklist (ChatGPT output template)

```text
## Verdict
Ready | Ready with fixes | Not ready

## Claim results
A1: ...
A2: ...
...
E9: ...

## Failures / contradictions
- ...

## Missing evidence
- ...

## Merge advice
- ...
```

---

## 13. Authorship / AI disclosure

- Implementation and this handover were prepared with AI coding assistance (Cursor Composer).
- OpenTelemetry GenAI contribution policy requires disclosure in the PR and human review of code/tests before upstream submission.
- External contributor authorship for unrelated open PRs (#3667 etc.) must be preserved; do not force-push their branches.

---

## 14. Timestamp

Handover prepared: **27 Oct 2026, 19:06 UTC** / **28 Oct 2026, 00:36 Asia/Calcutta**.  
Author-reported tests were run in the same working session before this document.
