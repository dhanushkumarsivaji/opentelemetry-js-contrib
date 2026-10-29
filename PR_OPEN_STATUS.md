# Upstream Draft PR status

**Tip SHA:** `8012ec1f7e426208415cb5a2474eab6fd1757cac`  
**Branch:** `dhanushkumarsivaji:cursor/instrumentation-openai-genai-util-20f0`  
**Base:** `open-telemetry/opentelemetry-js-contrib:main`

## Draft PR

**Not opened.** `gh` is authenticated as `dhanushkumarsivaji`, but `createPullRequest` returns **403 Resource not accessible by personal access token**.

One-click open (use **Create draft pull request**):

https://github.com/open-telemetry/opentelemetry-js-contrib/compare/main...dhanushkumarsivaji:cursor/instrumentation-openai-genai-util-20f0?quick_pull=1&title=feat%28instrumentation-openai%29%3A%20adopt%20genai-util%20and%20donated%20GenAI%20coverage

PR body draft: [`PR_DRAFT_BODY.md`](PR_DRAFT_BODY.md)

## Three commits (preserved)

| SHA | Subject |
| --- | --- |
| `526b35b9` | feat(genai-util): export public APIs for instrumentation consumers |
| `ab03e9da` | feat(instrumentation-openai): adopt genai-util and donated GenAI gaps |
| `8012ec1f` | fix(instrumentation-openai): address review privacy and attribution gaps |

All three: author `dhanushkumarsivaji`, `Re: #3668`, AI assistance disclosure.

## Diff vs upstream main — intended only

- `packages/genai-util/**` (exports, README release-order, CHANGELOG, utils comment)
- `packages/instrumentation-openai/**`
- `scripts/verify-pack.mjs` (remove empty-export skip)
- `package-lock.json` (workspace dep entry only)

## `^0.4.0` verification

| Source | Exports |
| --- | --- |
| npm `@opentelemetry/genai-util@0.4.0` | **empty** (`export {}`) |
| workspace `packages/genai-util` | TelemetryHandler, getErrorType, semconv, capture helpers, … |
| openai `dependencies` | `"@opentelemetry/genai-util": "^0.4.0"` |
| lockfile | `resolved: packages/genai-util`, `link: true` |

**Release order:** publish expanded genai-util **before or with** instrumentation-openai.

## TAV (`npm run test-all-versions -w @opentelemetry/instrumentation-openai`)

Overall: **`-- ok`**, exit **0** (2026-10-29 UTC).

| openai | Result |
| --- | --- |
| 6.49.0 | 74 passing |
| 6.47.0 | 74 passing |
| 4.104.0 | 51 passing, 23 pending |
| 4.57.0 | 51 passing, 23 pending |
| 4.19.0 | 51 passing, 23 pending |

## CI

No upstream PR → **no GitHub Actions CI URL yet**. CI will start after the Draft PR is opened.

## Disclosures in PR body

- Partial genai-util adoption (not full TelemetryHandler rewrite)
- GenAI conformance suite **not run** / no full-conformance claim
- `#3667` separate; not duplicated

## Outstanding review questions

1. Unknown host → `openai` protocol default OK?
2. Confirm genai-util release-before/with openai.
3. `[image]` placeholder vs omit image parts?
4. Defer TelemetryHandler + keep #3667 separate OK?
