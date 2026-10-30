# Lifecycle audit report — before updating PR #3872

**Candidate tip:** `be0309516499b2a901224f7ca0c79cb54fda1ad2`  
**Branch:** `cursor/openai-lifecycle-main-ffe6`  
**PR #3872 tip (unchanged):** `8012ec1f7e426208415cb5a2474eab6fd1757cac`  
**Do not update PR #3872 until explicitly approved.**

---

## 1. History / divergence reconciliation

| Ref | SHA | Notes |
| --- | --- | --- |
| PR #3872 tip | `8012ec1f` | 3 commits on top of `d50fe94e` (older `main`) |
| Prior lifecycle tip | `395a9b54` | Rebased onto newer `main` → **diverged** (rewritten SHAs), not a fast-forward of `8012ec1f` |
| Audited candidate | `be030951` | Rebuilt as: `upstream/main` ← cherry-equivalent of original 3 PR commits (authors preserved) ← lifecycle |

Current history (`upstream/main..HEAD`), all authored `dhanushkumarsivaji`:

1. `287d5052` feat(genai-util): export public APIs…  
2. `f9eaf6a9` feat(instrumentation-openai): adopt genai-util…  
3. `fc6fd244` fix(instrumentation-openai): address review privacy…  
4. `be030951` feat(instrumentation-openai): integrate TelemetryHandler lifecycle  

SHAs of (1)–(3) differ from `8012ec1f` parents because of **rebase onto current `main`** (includes undici security bump). Messages, authors, and AI / `#3668` disclosures are preserved. This is not a silent squash of the original PR into one commit.

---

## 2. File-level intended diff

### Against `upstream/main` (what GitHub would show for an updated #3872)

**No `instrumentation-undici`.** Files:

- `packages/genai-util/**` (exports, changelog, readme, utils comment)
- `packages/instrumentation-openai/**` (lifecycle rewrite + tests)
- `package-lock.json`, `scripts/verify-pack.mjs`

### Against PR tip `8012ec1f` (two-dot)

Also includes `packages/instrumentation-undici/package.json` (`undici` 6.28.1 → 6.29.1) **only because the candidate is based on newer `main` (`#3869`)**. That change is **not** in the lifecycle commit and **not** in `main...candidate`. It is **not accidental product code** from this work.

---

## 3. Test-case audit (titles + assertion themes)

### `openai.test.ts` titles

- PR tip: **43** cases · Candidate: **43** cases  
- **Removed titles: 0** · **Added titles: 0**

Streaming regression titles still present: connection errors, `.withResponse()`, double iteration, `tee`, streaming chat/responses (+ content capture).

### Assertion themes removed (same titles, different expectations)

| Theme | PR tip refs | Candidate |
| --- | --- | --- |
| `gen_ai.system` | 8 | **0** |
| Legacy message events (`system/user/assistant/tool.message`, `gen_ai.choice`) | many | **0** |
| `ATTR_EVENT_NAME` / `EVENT_GEN_AI_*` | 66 / 32 | **0** |
| `gen_ai.client.token.usage` histogram | 63 | **~0** (replaced by genai-util inference usage / TTFT metrics) |

**Interpretation:** suite titles preserved; **legacy event + old token histogram regressions were intentionally replaced** by TelemetryHandler-era assertions. This is a **behavior + test contract change**, not a silent title drop.

### `utils.test.ts`

**Removed (provider-mapping / old helpers):**

- All `getProviderNameFromBaseURL` cases (Azure/Bedrock/unknown/malformed) — provider is now always `openai` by semconv
- `setUsageDetailAttributes` edge cases — usage now via `InferenceInvocation.setUsage` / genai-util
- `formatChatMessageContent` cases — replaced by `parseUriOrBlobPart` redaction + message mappers

**Added:** `resolveCaptureMode`, `getOpenAIErrorType`, token/message mappers, redaction tests, Responses converters, etc.

### New files

- `genai-util-integration.test.ts` (7 cases)
- `stream-telemetry.test.ts` (5 cases: complete, early `return`, throw, `throw()` without source throw, **documents unconsumed ⇒ span open**)

---

## 4. Streaming wrapper audit

Implementation: `packages/instrumentation-openai/src/stream-telemetry.ts`

| Scenario | Status |
| --- | --- |
| Normal completion | Covered — `stop()` once |
| Early break / `return()` | Covered — `finalizeSuccess` once |
| Iterator throw / `throw()` | Covered — `fail()` once; `throw` aligned with #3831 `advance()` |
| Exactly-once | Covered — `finalized` guard; second `return`/`throw` no-ops hooks |
| **Unconsumed iterator** | **Not completed** — span stays open until explicit `stop()`; test documents limitation |
| Attach without ever calling `.iterator()` | **Same gap** at `_attachStreamTelemetry` (wrap installed, never pulled) |

**BLOCKER (quality / completeness):** unconsumed streams are **not** correctly ended. Matches classic OpenAI instrumentation and draft #9 attach semantics, but does **not** satisfy a strict “handles unconsumed streams” requirement. Needs an explicit product decision (accept as known limitation vs add timeout/FinalizationRegistry/eager finalize).

---

## 5. Checks run (this audit)

| Check | Result |
| --- | --- |
| compile `@opentelemetry/instrumentation-openai` | **PASS** |
| `npm test -w @opentelemetry/genai-util` | **153 passing** |
| `npm test -w @opentelemetry/instrumentation-openai` | **81 passing** |
| package eslint / lint:readme | **PASS** |
| `test-all-versions` | **PASS (`-- ok`)** |
| openai@6.49.0 / 6.47.0 | 81 passing |
| openai@4.104.0 / 4.57.0 / 4.19.0 | 56 passing, 25 pending |
| GenAI conformance (`instrumentation-openai`) | **NOT WIRED** — no `test/conformance`, no script |
| `instrumentation-langchain` `test:conformance` | Script exists; **`otel-conformance` binary not installed** in this env (`command not found`) |

---

## 6. Blockers / uncertainties (do not call “ready” until decided)

1. **Unconsumed stream spans** — not ended; need maintainer/product call.  
2. **Legacy event + `gen_ai.system` + old token histogram** removed — intentional with TelemetryHandler, but **not assertion-preserving** vs `8012ec1f`. Confirm this is acceptable for #3872.  
3. **OpenAI GenAI conformance** — cannot claim; suite not present; langchain runner unavailable here.  
4. **Updating #3872 rewrites PR tip SHAs** (rebase onto current `main`) — expected; original authorship preserved.

---

## 7. Recommendation

**Not ready to update #3872** until blockers (1) and (2) are explicitly accepted or fixed.

When approved:

1. Fast-forward / reset PR branch `cursor/instrumentation-openai-genai-util-20f0` to `be030951` (or merge this branch) — **only after your OK**.  
2. Call out undici as already-on-`main`, not part of the OpenAI diff.  
3. Disclose AI + draft #9 as design reference.

---

## Precise SHAs

- **Final candidate:** `be0309516499b2a901224f7ca0c79cb54fda1ad2`  
- **Intended diff vs PR tip:** `git diff 8012ec1f..be030951` (includes main’s undici bump in the tip-vs-tip view)  
- **Intended PR-vs-main diff:** `git diff upstream/main...be030951` (**no undici**)
