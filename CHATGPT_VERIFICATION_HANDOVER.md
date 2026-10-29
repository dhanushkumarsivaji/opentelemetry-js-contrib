# ChatGPT Verification Handover — instrumentation-openai × genai-util (#3668)

**Status:** Branch pushed to GitHub fork. Upstream PR **not** opened yet (waiting on your ChatGPT review + next instructions).  
**Prepared for:** ChatGPT independent verification.  
**AI disclosure:** Implementation and this handover were prepared with AI assistance (Cursor). Disclose that if/when opening the upstream PR.

---

## Paste this into ChatGPT first

```text
You are verifying an OpenTelemetry JavaScript Contrib contribution.

Primary sources (use these, do not invent results):
1. This handover document
2. GitHub branch / diff links below
3. Any files I attach

Rules:
- Mark each CHECKABLE CLAIM as PASS / FAIL / INCONCLUSIVE with evidence.
- Do not invent test results, conformance outcomes, or PR numbers.
- If you did not re-run tests, mark author-reported tests as INCONCLUSIVE.
- Reject Non-claims if anyone asserts them.
- End with verdict: Ready | Ready with fixes | Not ready
- Then list exact next actions for the human/agent (e.g. open upstream PR, fix X, rebase on #3667).

Handover follows.
```

---

## Live GitHub links (start here)

| What | URL |
| --- | --- |
| Fork | https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib |
| Feature branch | https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib/tree/cursor/instrumentation-openai-genai-util-20f0 |
| Diff vs fork `main` | https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib/compare/main...cursor/instrumentation-openai-genai-util-20f0 |
| Tip commit | https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib/commit/a99b9211f066f3433fc41665fe43a3436b23f5da |
| Tracking issue | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3668 |
| Do-not-duplicate PR | https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3667 |
| Related bug | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3586 |
| genai-util issue | https://github.com/open-telemetry/opentelemetry-js-contrib/issues/3681 |
| Unmerged TTFT helper | https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3831 |
| Donation source | https://github.com/open-telemetry/donation-openinference |
| This handover on GitHub | https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib/blob/cursor/handover-docs-20f0/CHATGPT_VERIFICATION_HANDOVER.md |
| Raw markdown | https://raw.githubusercontent.com/dhanushkumarsivaji/opentelemetry-js-contrib/cursor/handover-docs-20f0/CHATGPT_VERIFICATION_HANDOVER.md |

**Upstream PR:** not created yet. Open only after review, against `open-telemetry/opentelemetry-js-contrib` from this fork branch.

---

## Branch identity

| Item | Value |
| --- | --- |
| Branch | `cursor/instrumentation-openai-genai-util-20f0` |
| Base (upstream main when built) | `d49c2fd5ac5a0758f9b1569e3f2ba7e8232ee912` |
| Commit 1 | `b0526a420ddd0cbe10204f526030f184f65b1819` — `feat(genai-util): export public APIs for instrumentation consumers` |
| Commit 2 | `a99b9211f066f3433fc41665fe43a3436b23f5da` — `feat(instrumentation-openai): adopt genai-util and donated GenAI gaps` |
| Tip SHA on GitHub | `a99b9211f066f3433fc41665fe43a3436b23f5da` |
| Diffstat | 14 files, +469 / −38 |

### Clone locally

```bash
git clone https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib.git
cd opentelemetry-js-contrib
git checkout cursor/instrumentation-openai-genai-util-20f0
git log --oneline d49c2fd5ac5a0758f9b1569e3f2ba7e8232ee912..HEAD
# expect exactly the two commits above
```

---

## Exact files changed

### `@opentelemetry/genai-util`
- `packages/genai-util/src/index.ts`
- `packages/genai-util/src/utils.ts`
- `packages/genai-util/README.md`
- `packages/genai-util/CHANGELOG.md`
- `knip.jsonc`
- `scripts/verify-pack.mjs`

### `@opentelemetry/instrumentation-openai`
- `packages/instrumentation-openai/package.json`
- `package-lock.json` (dependency entry only)
- `packages/instrumentation-openai/src/utils.ts`
- `packages/instrumentation-openai/src/instrumentation.ts`
- `packages/instrumentation-openai/test/utils.test.ts`
- `packages/instrumentation-openai/test/openai.test.ts`
- `packages/instrumentation-openai/README.md`
- `packages/instrumentation-openai/CHANGELOG.md`

**Scope:** no other instrumentation packages; Bedrock conformance untouched.

---

## What was implemented

1. Export genai-util public APIs (`TelemetryHandler`, types, content-capture helpers, `getErrorType`, semconv). Package previously exported nothing.
2. `instrumentation-openai` depends on `@opentelemetry/genai-util@^0.4.0` and uses `getErrorType`.
3. Detect `gen_ai.provider.name` from OpenAI-compatible baseURL (Azure etc.; default `openai`).
4. Keep deprecated `gen_ai.system=openai` on chat/embeddings for compatibility.
5. Record `gen_ai.usage.cache_read.input_tokens` / `gen_ai.usage.reasoning.output_tokens` when count `> 0`.
6. Opt-in chat content capture includes image URLs (and refusal text).

---

## Intentionally deferred

- Full `TelemetryHandler` span lifecycle rewrite
- `getContentCaptureMode` adoption (genai-util maps env `true` → `none`; openai still uses boolean `true`/`false`)
- Legacy Completions API
- Tool JSON-schema capture
- TTFT / `wrapAsyncStream` (#3831 unmerged)
- `#3586` / `#3667` APIPromise parse double-read fix (do not duplicate)
- Monorepo-wide lint, TAV, GenAI conformance suite (not run in authoring session)

---

## CHECKABLE CLAIMS

### A. genai-util exports
| ID | Claim |
| --- | --- |
| A1 | Before this branch, genai-util `index.ts` had empty public surface. |
| A2 | After commit 1, exports TelemetryHandler, invocation types, capture helpers, getErrorType, semconv. |
| A3 | Invocations exported as `export type` only. |
| A4 | knip genai-util ignore removed. |
| A5 | verify-pack no longer skips genai-util. |

### B. openai adoption
| ID | Claim |
| --- | --- |
| B1 | Depends on `@opentelemetry/genai-util: ^0.4.0`. |
| B2 | Uses `getErrorType` from genai-util. |
| B3 | Public config still `captureMessageContent?: boolean`. |
| B4 | Content capture still opt-in default off via boolean env. |
| B5 | Does **not** call `getContentCaptureMode`. |
| B6 | Does **not** use `TelemetryHandler` for span lifecycle. |

### C. Donated gaps (GenAI-mapped)
| ID | Claim |
| --- | --- |
| C1 | Provider detection from hostname with GenAI enums. |
| C2 | Chat/embeddings set provider.name + keep gen_ai.system. |
| C3 | Responses uses detected provider. |
| C4 | Usage details only when number `> 0`. |
| C5 | Usage helper called on chat/stream/responses paths. |
| C6 | Opt-in capture includes image URLs. |
| C7 | No OpenInference `llm.*` / `openinference.*` attrs added. |

### D. Non-overlap
| ID | Claim |
| --- | --- |
| D1 | Does not implement #3667 parse fix. |
| D2 | Completions API still not instrumented. |
| D3 | No wrapAsyncStream / TTFT. |
| D4 | No Bedrock conformance changes. |

### E. Author-reported tests (re-run to confirm)
Environment: Node `v22.23.4`, npm `10.9.9`.

| ID | Command | Reported |
| --- | --- | --- |
| E1 | `npx nx run @opentelemetry/genai-util:compile` | PASS |
| E2 | `npx nx run @opentelemetry/instrumentation-openai:compile` | PASS |
| E3 | `npm test -w @opentelemetry/genai-util` | 152 passing |
| E4 | `npm test -w @opentelemetry/instrumentation-openai` | 63 passing |
| E5 | package lint both | PASS (2 pre-existing warnings in untouched `responses.ts`) |
| E6 | lint:readme both | PASS |
| E7 | full monorepo lint | Not run |
| E8 | test-all-versions | Not run |
| E9 | semantic-conventions-conformance | Not run |

If ChatGPT did not re-run E1–E6 → mark **INCONCLUSIVE (author-reported)**.

---

## Feature gap matrix (donation vs existing)

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

## genai-util APIs: exported vs consumed

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

## Non-claims (reject if asserted)

1. Fully migrated to TelemetryHandler  
2. Passed GenAI conformance suite  
3. Fixes #3586 / overlaps #3667  
4. Completions API instrumentation  
5. TTFT / wrapAsyncStream  
6. ContentCaptureMode end-to-end  
7. Upstream PR already opened/merged  
8. Monorepo lint / TAV green in this session  
9. Any performance benchmarks  
10. Ported OpenInference `llm.*` attributes  

---

## Compatibility risks

- Additive `gen_ai.provider.name` on chat/embeddings (tests updated).
- `error.type` via `getErrorType` (code → name → constructor).
- Zero usage details omitted.
- Public config unchanged.
- Rebase carefully against open #3667.

---

## Proposed upstream PR (do not open until instructed)

**Title:** `feat(instrumentation-openai): adopt genai-util and port donated provider/usage coverage`

**Body:**

```markdown
## Which problem is this PR solving?

Re: #3668

Reconcile `@opentelemetry/instrumentation-openai` with donated OpenInference coverage and begin shared `@opentelemetry/genai-util` adoption. Brownfield only: does not replace the package; does not port OpenInference attribute names.

## Short description of the changes

- Export stable genai-util public APIs for instrumentation consumers.
- Depend on `@opentelemetry/genai-util` from instrumentation-openai.
- Detect `gen_ai.provider.name` from OpenAI-compatible base URLs.
- Record cache-read / reasoning usage details when non-zero.
- Include image URLs in opt-in chat content capture.
- Preserve public config, streaming, metrics, and privacy defaults.

## Important Info

- Does not address #3586 / does not overlap #3667.
- Full TelemetryHandler lifecycle migration deferred.
- AI assistance was used while drafting; human review required.
```

### Open command (only when approved)

```bash
gh pr create --repo open-telemetry/opentelemetry-js-contrib \
  --base main \
  --head dhanushkumarsivaji:cursor/instrumentation-openai-genai-util-20f0 \
  --title "feat(instrumentation-openai): adopt genai-util and port donated provider/usage coverage" \
  --body-file - <<'EOF'
(...paste body above...)
EOF
```

---

## Recommended follow-ups

1. Rebase/coordinate with #3667  
2. Content-capture compatibility (`true`/`false` + `span_only`/`none`) then adopt `getContentCaptureMode`  
3. Incremental TelemetryHandler (embeddings first)  
4. Legacy Completions  
5. TTFT after #3831  
6. GenAI conformance scenarios  

---

## ChatGPT output template

```text
## Verdict
Ready | Ready with fixes | Not ready

## Claim results
A1..E9: PASS/FAIL/INCONCLUSIVE + evidence

## Failures / contradictions
- ...

## Missing evidence
- ...

## Exact next actions for the human/agent
1. ...
2. ...
```

---

## Timestamp

Branch pushed to GitHub: **29 Oct 2026 ~09:35 Asia/Calcutta**.  
Author-reported tests from the earlier implementation session (27 Oct 2026).  
Handover refreshed for ChatGPT: **29 Oct 2026 ~09:38 Asia/Calcutta**.
