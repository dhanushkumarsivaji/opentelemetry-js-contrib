# Lifecycle audit report — before updating PR #3872

**Candidate tip:** `fcdb5ae4c063153df74c84d2be6e54bc390a1460`  
**Branch:** `cursor/openai-lifecycle-main-ffe6`  
**Base:** `upstream/main` including merged `#3831` (`b6d9900c`)  
**PR #3872 tip (unchanged):** `8012ec1f7e426208415cb5a2474eab6fd1757cac`  
**Do not update PR #3872 until explicitly approved.**

---

## 1. History / divergence reconciliation

| Ref | SHA / note |
| --- | --- |
| PR #3872 tip | `8012ec1f` — 3 commits on older `main` |
| Prior audited tip | `be030951` — TelemetryHandler lifecycle on pre-`#3831` main |
| Merged `#3831` | `b6d9900c` on `upstream/main` (2026-11-02) — official `wrapAsyncStream` |
| This candidate | Rebased lifecycle commits onto `upstream/main` (**no duplicate `#3831` commits**), then swapped local stream helper for `TelemetryHandler.wrapAsyncStream` + restored `gen_ai.system` |

Current history (`upstream/main..HEAD`), authored `dhanushkumarsivaji`:

1. `feat(genai-util): export public APIs for instrumentation consumers`  
2. `feat(instrumentation-openai): adopt genai-util and donated GenAI gaps`  
3. `fix(instrumentation-openai): address review privacy and attribution gaps`  
4. `feat(instrumentation-openai): integrate genai-util TelemetryHandler lifecycle`  
5. `docs: add pre-PR lifecycle audit report`  
6. *(this follow-up)* adopt merged `#3831` wrapAsyncStream + `gen_ai.system` compatibility  

Authorship / `#3668` / AI disclosures preserved through rebase. `#3831` itself is **only** via merge-base on `main`, not cherry-picked again.

---

## 2. Changes in this follow-up

### Streaming (`#3831` adoption)

- Removed local `wrapAsyncIteratorWithTelemetry` stand-in.
- Added `attachOpenAIStreamTelemetry` which calls **`TelemetryHandler.wrapAsyncStream`**.
- OpenAI `Stream` keeps the producer on own-property `iterator`; `tee()` consumes via `this.iterator()` and would bypass a Symbol-only wrap. The helper feeds a producer proxy into `wrapAsyncStream`, then points both `iterator` and `[Symbol.asyncIterator]` at the wrapped pull path (no recursion).
- Preserves stream object identity for `.withResponse()` / `.tee()` / `instanceof`.
- On stream errors, ends the invocation with `getOpenAIErrorType` before `wrapAsyncStream`'s `fail()` (no-op if already ended) so RateLimitError / APIError subclasses keep consistent `error.type`.

### Legacy compatibility

| Signal | Decision |
| --- | --- |
| `gen_ai.provider.name=openai` | **Required** — always set via TelemetryHandler (OpenAI-specific semconv / maintainer feedback) |
| Deprecated `gen_ai.system=openai` | **Restored** on chat + embeddings only (matches `#3872` tip / published behavior). Different key from `provider.name` → no attribute collision |
| Legacy message / choice log events | **Not dual-emitted** — would duplicate `gen_ai.input/output.messages` |
| `gen_ai.client.token.usage` | **Not dual-emitted** — replaced by `gen_ai.client.inference.usage.*`; tests assert absence |

### Privacy / content capture

- Default-off content capture unchanged.
- Image / data URLs / audio / file parts still redacted under opt-in capture (`parseUriOrBlobPart`).

### Files touched (product)

- `packages/instrumentation-openai/src/instrumentation.ts`
- `packages/instrumentation-openai/src/stream-telemetry.ts` (now OpenAI routing adapter around official wrap)
- `packages/instrumentation-openai/test/{stream-telemetry,genai-util-integration,openai}.test.ts`
- `LIFECYCLE_REVIEW_REPORT.md`

`packages/genai-util/src/stream.ts` is **from main `#3831` only** — not reintroduced in our diff.

---

## 3. Diff scope vs `upstream/main` / PR tip

### vs `upstream/main` (intended PR update surface)

- `packages/genai-util/**` — public export surface + changelog/readme only (**no** stream.ts; that is already on main)
- `packages/instrumentation-openai/**` — TelemetryHandler lifecycle + `#3831` attach adapter + tests
- `LIFECYCLE_REVIEW_REPORT.md`, `package-lock.json`, `scripts/verify-pack.mjs`
- **No `instrumentation-undici`**

### vs PR tip `8012ec1f` (two-dot)

Also includes commits already on newer `main` (undici `#3869`, langchain `#3821`, **`#3831`**, …). Those are **not** product changes from this lifecycle work.

---

## 4. Streaming / lifecycle verification

| Scenario | Status |
| --- | --- |
| Chat / embeddings / Responses non-stream | Covered by `openai.test.ts` + integration |
| Normal streaming | Covered — `wrapAsyncStream` finalize once |
| Early break / `return()` | Covered — unit + openai streaming |
| Iterator throw | Covered — fail once; OpenAI error.type preserved |
| Double iteration | Covered — OpenAI consumed-stream error; telemetry finalize once |
| `.withResponse()` | Covered — Responses + chat streaming tests |
| `tee()` | Covered — adapter routes `iterator()`; openai + unit tee tests |
| Exactly-once end | Covered — `wrapAsyncStream` `isFinalized` + early `fail()` no-op |
| Instrumentation hook errors | Swallowed / logged; do not break app iteration (`wrapAsyncStream` + attach try/catch) |
| **Unconsumed stream** | **Span stays open** — documented; no timeout / FinalizationRegistry |

### Maintainer question (Pranav)

> Is an open span for a returned-but-never-iterated stream an accepted known limitation (parity with published instrumentation-openai and `#3831` `wrapAsyncStream`), or should request-start / TTFT / nesting semantics change?

---

## 5. Checks run

| Check | Result |
| --- | --- |
| compile `@opentelemetry/genai-util` | **PASS** |
| compile `@opentelemetry/instrumentation-openai` | **PASS** |
| `npm test -w @opentelemetry/genai-util` | **174 passing** (includes `#3831` stream suite) |
| `npm test -w @opentelemetry/instrumentation-openai` | **82 passing** |
| package eslint / lint:readme | **PASS** (no errors) |
| `test-all-versions` | **PASS (`-- ok`)** |
| openai@6.49.0 / 6.47.0 | 82 passing |
| openai@4.104.0 / 4.57.0 / 4.19.0 | 57 passing, 25 pending |
| GenAI conformance (`instrumentation-openai`) | **NOT WIRED** — no suite/script |
| `instrumentation-langchain` `test:conformance` | Script exists; **`otel-conformance` not installed** here |

---

## 6. Remaining limitations / blockers

1. **Unconsumed stream spans** — still open by design parity; needs Pranav/product call (§4).  
2. **Legacy events + old token histogram** — intentionally not dual-emitted; confirm acceptable for `#3872` consumers.  
3. **OpenAI GenAI conformance** — cannot claim; suite absent.  
4. **Updating `#3872` rewrites PR tip SHAs** (rebase onto current `main` + `#3831`) — expected; authorship preserved.

---

## 7. Recommended PR update strategy (when approved)

1. Push `cursor/openai-lifecycle-main-ffe6` for review (**this branch may be pushed without updating the PR**).  
2. After explicit OK: reset / fast-forward PR branch `cursor/instrumentation-openai-genai-util-20f0` to this tip — **do not force-push until approved**.  
3. In the PR body: note `#3831` is already on `main`; this PR consumes `TelemetryHandler.wrapAsyncStream` via an OpenAI `iterator`/`tee` adapter; disclose AI + draft `#9` as design reference; call out undici/`#3831` as already-on-main in tip-vs-tip views.  
4. Ask Pranav the unconsumed-stream question and confirm legacy event/metric drop.

---

## 8. Recommendation

**NO-GO for updating `#3872` yet** until:

- Pranav accepts the unconsumed-stream limitation (or directs a different lifecycle), and  
- Legacy event / `gen_ai.client.token.usage` removal is explicitly accepted.

The `#3831` integration itself is implemented and tested on this branch.

---

## Precise SHAs

- **PR tip (unchanged):** `8012ec1f7e426208415cb5a2474eab6fd1757cac`  
- **Prior audited tip:** `be0309516499b2a901224f7ca0c79cb54fda1ad2`  
- **`#3831` on main:** `b6d9900ce36a226ff0c14d774294b147fe5ca00d`  
- **Final candidate:** `fcdb5ae4c063153df74c84d2be6e54bc390a1460`
- **Implementation commit (#3831 adoption):** `a3e38d547d77fb5192aaa4ef2908dd81a48362ed`  
- **Intended PR-vs-main:** `git diff upstream/main...HEAD` (**no undici; no duplicated stream.ts**)  
- **Intended tip-vs-tip:** `git diff 8012ec1f..HEAD` (includes main’s `#3831` / undici / etc.)
