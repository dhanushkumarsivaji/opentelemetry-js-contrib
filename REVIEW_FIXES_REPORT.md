# Review fixes report — Ready with fixes → addressed

**Branch:** `cursor/instrumentation-openai-genai-util-20f0`  
**Previous tip:** `a99b9211f066f3433fc41665fe43a3436b23f5da`  
**Updated tip:** `3146d04e9474fa75747d12a389456c9673287125`  
**Diff:** https://github.com/dhanushkumarsivaji/opentelemetry-js-contrib/compare/main...cursor/instrumentation-openai-genai-util-20f0  
**Upstream PR:** not opened / not merged

Commits on branch (rebased onto latest `origin/main`):

1. `11a91acb` feat(genai-util): export public APIs for instrumentation consumers  
2. `2bdbb107` feat(instrumentation-openai): adopt genai-util and donated GenAI gaps  
3. `3146d04e` fix(instrumentation-openai): address review privacy and attribution gaps  

---

## 1. genai-util exports / `^0.4.0` / workspace / publishing

| Check | Result |
| --- | --- |
| Exports | Superset of main (langchain already exported `TelemetryHandler`, `ToolInvocation` type, `ATTR_GEN_AI_TOOL_CALL_ID`). We add options/types, capture helpers, `getErrorType`, `export *` from semconv (includes `ATTR_GEN_AI_TOOL_CALL_ID`). |
| openai dep | `"@opentelemetry/genai-util": "^0.4.0"` |
| Workspace resolution | `package-lock` links `node_modules/@opentelemetry/genai-util` → `packages/genai-util` |
| Runtime export smoke | `TelemetryHandler` function, `getErrorType` function, `ATTR_GEN_AI_TOOL_CALL_ID === 'gen_ai.tool.call.id'` |
| Versioning | Remains `0.4.0` in workspace (additive exports; matches langchain pattern). **npm-published `0.4.0` may lag until release-please ships Unreleased exports** — open risk for out-of-monorepo consumers until release. |
| Rebase | Conflict-resolved with `#3821` genai-util README/index on main |

## 2. Image URL capture (privacy)

**Fix:** raw / signed / `data:` URLs are **never** exported. Opt-in capture records image parts as `[image]` only (`formatChatMessageContent` + `IMAGE_CONTENT_PLACEHOLDER`).

Tests cover signed query tokens, data URIs, malformed objects, default empty for non-arrays. Capture remains default-off via existing boolean config/env.

## 3. Provider detection

- Known hosts: OpenAI, Azure OpenAI, Azure AI Inference, etc.  
- Bedrock: only hostnames containing `bedrock` under `amazonaws.com` (S3 etc. no longer mis-attributed).  
- Unknown OpenAI-compatible hosts / malformed URLs: default `openai` (SDK protocol default), documented in README.  
- Unit tests added for each class.

## 4. Usage detail values

`setUsageDetailAttributes` now requires **positive finite** numbers (`Number.isFinite` && `> 0`).  
Tests: zero, negative, missing, non-numeric, NaN/Infinity, null, streaming partial objects.

## 5. Upstream `#3667` / latest main

- Rebased onto `origin/main` (`d50fe94e`… includes langchain `#3821`).  
- Diff contains **no** `parseResponse` / `_thenUnwrap` / raw-response observer changes.  
- `#3667` remains open and untouched; no authorship conflict.

## 6. Test evidence (this session)

Environment: Node `v22.23.4`, npm `10.9.9`.

| Check | Result |
| --- | --- |
| `nx run @opentelemetry/genai-util:compile` | **PASS** (exit 0) — log `/tmp/review-evidence/compile.log` |
| `nx run @opentelemetry/instrumentation-openai:compile` | **PASS** (exit 0) |
| `npm test -w @opentelemetry/genai-util` | **PASS — 153 passing** — `/tmp/review-evidence/genai-util-test.log` |
| `npm test -w @opentelemetry/instrumentation-openai` | **PASS — 74 passing** — `/tmp/review-evidence/openai-test.log` |
| package eslint (both) | **PASS** (openai: 2 pre-existing warnings in untouched `responses.ts`) — `/tmp/review-evidence/lint.log` |
| `lint:readme` (both) | **PASS** |
| full monorepo `npm run lint` | **NOT RUN** |
| `test-all-versions` / TAV | **NOT RUN** (`.tav.yml` present) |
| GenAI semantic-conventions-conformance | **NOT RUN** (suite not wired here) |

## 7. Critical review summary

| Area | Status |
| --- | --- |
| API drift | Public openai config unchanged (`captureMessageContent?: boolean`). genai-util exports additive. |
| Data leaks | Image URL leak closed via placeholder. Content still opt-in. |
| Dependencies | Only `@opentelemetry/genai-util@^0.4.0` added to openai. |
| Unrelated packages | Not modified. Diff limited to genai-util + instrumentation-openai + verify-pack + lock entry. |
| TelemetryHandler rewrite | Not done (as requested). |

---

## Open risks (remaining)

1. **npm lag:** published `@opentelemetry/genai-util@0.4.0` may not yet include the expanded exports until the next release of Unreleased changes (monorepo OK).  
2. **Unknown-host default `openai`:** protocol default, not operator identity — documented.  
3. **`#3667` still open:** structured-output body double-read remains a separate bug; rebase again when it merges.  
4. **TAV / conformance / full monorepo lint:** not executed in this session.  
5. **Chat Completions still use deprecated `gen_ai.system` + legacy events** (compatibility; deferred modernization).

---

## Final readiness

**Ready with residual risks** (above), suitable for human review before opening the upstream PR.  
Do **not** open/merge upstream until you confirm.

Suggested next step after your OK: open PR from  
`dhanushkumarsivaji:cursor/instrumentation-openai-genai-util-20f0` → `open-telemetry/opentelemetry-js-contrib:main`.
