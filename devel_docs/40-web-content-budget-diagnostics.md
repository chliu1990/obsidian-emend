# Stage 40: Web content-budget diagnostics

## Status and scope

The shared-content-budget diagnostic fix is implemented and verified locally on `fix/web-content-budget-diagnostics`. No real-provider verification, external pull request, or GitHub CI run was performed; external publishing remains deferred.

Stage 36's independent Web limits are unchanged. `maxWebToolCalls` still limits model-requested Search/Fetch calls to a normalized 1–20 range, while retrieved snippets, summaries, Search content, and Fetch content still share a separate 40,000-character per-submission budget. The setting does not raise, lower, or otherwise change that content budget.

## Confirmed cause and behavior

Task 1 reproduced the issue with two content-heavy Search rounds at setting 20. Five 6,000-character results per round consumed the 40,000-character shared budget during the second Search even though only two calls had been used. There was no HTTP 402 or call-count failure, and the ready answer had no deterministic omission warning.

The Web loop now returns a transient `contentBudgetExhausted: boolean` result. It becomes true only when the shared budget omits content or a later call is skipped because that budget is exhausted. Ordinary 6,000-character per-Search-result or 12,000-character per-Fetch truncation alone leaves it false. Read-only coordination forwards the flag without gaining a writer.

When the flag is true, chat appends exactly this diagnostic once to the ready answer:

```text
Web retrieval reached its 40,000-character content budget. Some retrieved content was omitted; the answer may be incomplete.
```

The warning is ordinary sanitized ready-message content and survives conversation reload without duplication. The transient flag itself, raw tool arguments/results, and retrieved content are not persisted. Fatal Search errors, fatal Fetch HTTP 400/401/402/413 responses, and aborts retain their existing behavior. No retry, fallback, provider call, budget increase/coupling, note write, citation/activity change, or usage-semantics change was added.

## TDD and automated verification

The focused regression assertions were written before production changes and run with:

```bash
npm test -- tests/deepseek-web.test.ts tests/request-coordinator.test.ts tests/chat-view.test.ts
```

The expected RED result was **3 failed files, 8 failed tests, 152 passed tests (160 total)**. Every failure was the absent `contentBudgetExhausted` value or absent chat warning; there were no setup errors. The assertions cover shared-budget truncation, a skipped later call, false values for no retrieval and ordinary per-result/per-fetch truncation, read-only result propagation, and one warning in the final persisted ready message.

After the minimal implementation, the same command passed **3 files and 160 tests**. An initial strict-build check also caught a test-only untyped persistence mock; its signature was corrected without changing the behavior under test. The final full gate was:

```bash
npm test && npm run lint && npm run build && git diff --check
```

Result: **36 Vitest files and 869 tests passed**, ESLint reported no findings, strict TypeScript and production esbuild succeeded, and `git diff --check` reported no errors. Existing focused fatal/abort regressions passed, including Search failure without another model round, Review cancellation before retrieval, and fatal Fetch HTTP 400/401/402/413 cases.

## Real-Obsidian loopback evidence

- Date: 2026-11-09, Asia/Shanghai.
- Runtime: the Stage 36 official Obsidian 1.15.0 AppImage assets, isolated Xvfb `:99`, CDP `19222`, and CORS loopback chat/Search mock at `127.0.0.1:8765`.
- Data: only new synthetic notes and configuration under ignored `test_vault/emend-web-verify/runtime-issue45/`, with the harness's dummy SecretStorage credential. No real provider/account/key, external or paid request, other vault, retry, fallback, or note write was used.
- Bundle: root and tested `main.js` SHA-256 were both `d09030c88449b785d98b500d52d6597c735dada201a4f408dbdd3ef17ce7c360`.
- Command: `node test_vault/emend-web-verify/verify.mjs --issue45`.
- Result: **4/4 scenarios and 32/32 assertions passed**. The request audit covered 48 entries with zero header violations and zero dummy-credential leaks. Owned Obsidian, Xvfb, and mock processes were stopped after the run.

For each of `deepseek-flash` and `deepseek-v4-pro`, the two-heavy-Search scenario used setting 20 and the exact completion/Search/completion/Search/terminal-completion sequence. The second payload retained the Task 1 boundary lengths `[6000, 4005, 5, 5, 5]`. The ready message contained the answer plus exactly one required warning; schema 2 stored that exact content, excluded raw retrieved content and the transient flag, and an actual application reload restored one warning without duplication. Both notes remained byte-for-byte unchanged.

The nine-Search scenario also ran for each supported model at actual setting 20. Each produced exactly **10 completion requests, 9 actual Search requests, and 0 Fetch requests**, with ordered queries `Issue45 nine search 1` through `Issue45 nine search 9`. Every result retained its complete 100-character content, nine unique citations and completed activities appeared, and no budget warning was added. Schema 2 excluded raw content and the transient flag, and both notes remained byte-for-byte unchanged.

Evidence is retained under ignored paths:

- `test_vault/emend-web-verify/evidence-issue45/summary.json`
- `test_vault/emend-web-verify/evidence-issue45/issue45-evidence.json`
- `test_vault/emend-web-verify/evidence-issue45/request-log.json`
- `test_vault/emend-web-verify/evidence-issue45/logs/`
- `test_vault/emend-web-verify/evidence-issue45/issue45-*.png`

The loopback mock and verifier retain the two-heavy-Search and nine-Search scenarios for reproducibility. No claim is made about real-provider wording or behavior beyond the confirmed local shared-budget mechanism and diagnostic.
