# Stage 22: Deferred roadmap and release verification

## Goal

Document actionable context-management and web-search designs without implementing either feature, align all current guides with the hardened Operations-only/SecretStorage release, rerun clean automated and real-Obsidian verification, review the task and complete hardening change, and record final Gitea CI evidence. Do not merge or publish.

## Plan

1. Specify per-provider context/output limits, honest estimated/provider usage, a categorized progress bar, a configurable default-75% compression threshold, explicit privacy/cost behavior, complete-source Edit failure, and Modify Selection fallback in a deferred context-management document.
2. Specify provider-specific search capability detection, explicit opt-in, citations, errors, privacy, and tests in a deferred web-search document, with no background searches or shared-schema assumptions.
3. Update README, quick start, installation, current architecture, implementation index, and roadmap for Operations-only editing, current DeepSeek/Kimi presets, SecretStorage cleanup, presentation behavior, and deferred work. Preserve historical records.
4. Run `npm ci && npm test && npm run lint && npm run build && git diff --check`. Exercise title/timed streaming, provider preset labels, all three selection actions, Operations/Track Changes, SecretStorage migration, and reload persistence in isolated real Obsidian with a loopback mock and dummy credentials.
5. Self-review this task and the whole hardening change, commit `docs: prepare hardened release and future roadmap`, push, verify `emend-macos-docker` through the tea API, and add documentation-only CI evidence if needed. Do not merge or publish.

## Implementation details

- `devel_docs/future-context-management.md` is explicitly deferred. It defines per-provider capacity/output reserve, labeled estimate versus provider accounting, a system/instructions-note-history-user-output progress breakdown, default 75% threshold, explicit compression privacy/cost, no silent full-note truncation, safe no-write failures, and complete-selection fallback rules plus implementation/test sequences.
- `devel_docs/future-web-search.md` is explicitly deferred. It requires independent provider capabilities/schemas, default-off request opt-in, no background detection/search, result-backed safe citations, credential-safe errors, privacy disclosure, and provider-specific unit/integration tests.
- Current `README.md`, `QUICK_START.md`, and `INSTALLATION.md` link the deferred designs, name the editable DeepSeek `deepseek-flash` and Kimi `k3.1-pro` presets, describe Operations as the only model-facing protocol, and explain SecretStorage migration and uninstall/key-cleanup implications.
- `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, and `devel_docs/00-roadmap.md` now index Stage 22 and both deferred designs. Current architecture records immediate plain-text loading followed by guarded ready/stopped Markdown rendering. Earlier stage records, including historical strategy choices, were not rewritten.
- No `src/`, `tests/`, `styles.css`, dependency, manifest, command-ID, or other runtime file changed in this stage. Generated bundles, isolated vault/profile data, request logs, verification scripts/results, dummy settings, and credentials remain ignored under `test_vault/`.

## Verification results

### Clean local gate

- Actual command: `npm ci && npm test && npm run lint && npm run build && git diff --check`.
- `npm ci` installed 351 packages from the committed lockfile. `npm test` passed **22 files and 421 tests**. ESLint completed with no findings, strict TypeScript checking and production esbuild succeeded, and `git diff --check` passed.
- The production bundle from this gate was copied into the isolated Stage 22 vault. No runtime source or test file changed in this stage.

### Real Obsidian and local-mock smoke matrix

- Environment: production Emend in ignored `test_vault/stage22_vault`, isolated profile `test_vault/.emend-test-profile-22`, real Obsidian on macOS reporting `obsidian/1.11.7`, CDP 9336, Track Changes, and a CORS-enabled loopback SSE mock at `http://127.0.0.1:8800/v1`. Only dummy credentials were seeded. No real account, paid request, external provider call, or other vault was used.
- Actual commands: `node test_vault/cdp-eval-22.mjs test_vault/stage22-scenarios.js`, an actual `location.reload()` through CDP, `node test_vault/cdp-eval-22.mjs test_vault/stage22-after-reload.js`, and `node test_vault/verify-stage22.mjs`. The final verifier passed **5 actual requests**, **3 selection actions**, **4 freshly rebuilt Track Changes panels**, migration, and reload assertions.
- The timed mock emitted four chunks at 101, 601, 1101, and 1602 ms. Actual visible loading prefixes were `Streaming **` at 252 ms, `Streaming **Markdown` at 754 ms, and ``Streaming **Markdown** with `code` `` at 1255 ms. At 1757 ms the ready body contained bold `Markdown` and `complete` plus inline `code`. `getDisplayText()` and the header were `Emend` throughout, and `Stream22.md` remained byte-for-byte unchanged.
- The actual settings UI listed DeepSeek, Kimi, and Custom. DeepSeek showed model option `deepseek-flash` and base URL `https://api.deepseek.com`; Kimi showed `k3.1-pro` and `https://api.kimi.com/coding/v1`; Custom showed `Custom model`. Provider API-key labels were present and no **Edit strategy** setting existed.
- Full-note Operations produced exactly `Alpha {~~beta~>STAGE22_FULL~~} gamma.` and one live Track Changes replacement card. All four edit requests used a system prompt containing `bare JSON array`; none contained the removed complete-note CriticMarkup strategy instruction.
- Actual modal clicks for Fix grammar, Make concise, and Add examples each began with three enabled actions and an empty textarea, disabled the input/actions/submit control while pending, submitted the exact shared prompt once, closed after success, and produced respectively `This sentence {~~have~>has~~} a small grammar problem.`, `{~~This is a sentence that is unnecessarily very long.~>This sentence is too long.~~}`, and `Emend validates edits.{++ For example, invalid operations leave the source unchanged.++}`. Their live panels showed the expected replacement, replacement, and insertion cards.
- Initial plaintext fixtures for all three providers migrated on actual plugin load. Boolean-only evidence confirmed empty in-memory/persisted `apiKey` fields, all exact SecretStorage IDs, and resolution through both plugin helpers and direct SecretStorage reads. After the real renderer reload, all secrets resolved again; another actual `saveSettings()` kept every persisted field empty. Verification output did not include credential values.
- After reload, the Stream22 thread restored exactly two ready messages from local persistence, the title remained `Emend`, the streaming fixture remained unchanged, and the full-note Operation result remained present.
- The first launch stopped at the expected fresh-vault trust prompt; accepting trust only in the disposable profile loaded Emend and Track Changes before any smoke assertions. A verifier expectation initially used singular `1 change`; it was corrected to the observed established copy `1 changes tracked` without changing runtime or weakening other assertions. Only the isolated Obsidian process and mock were stopped afterward; the pre-existing Obsidian process remained running.

### Task and whole-hardening self-review

- The Stage 22 diff was reviewed against `406ed1e12cd2cbe5ca508f8d26e9468b4cb4e722`. Both deferred documents contain every required design point, explicit non-current status, implementation order, and future tests. Current guides consistently describe Operations-only editing, exact presets, SecretStorage cleanup, immediate loading/final rendering, and deferred work. Historical stage records were not rewritten.
- The complete hardening diff from `073766a` through the Stage 22 working tree was also reviewed. Operations remains the only model-facing edit protocol while internal CriticMarkup validation/Track Changes remains intact; selection actions reuse the existing guarded submission path; SecretStorage migration/sanitized saves/request resolution retain provider independence; no second provider transport or note writer was introduced.
- No new correctness, security, privacy, documentation, or verification blocker was found in these self-reviews. No independent reviewer tool was available in this implementation run, so this records self-review rather than external approval.
- No generated bundle, vault/profile content, request/result log, verification script, dummy plugin data, credential, or other ignored file is intended for git. No merge or release publication is part of this stage.

## Implementation-run CI evidence

Implementation commit `0a8333bbb59abbafb9d9a413695f1e911986ae93` was pushed on `feat/emend-rewrite`. Gitea push run 105 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/105 and job 127 completed with conclusion **success** on `emend-macos-docker` from 16:32:49Z through 16:33:12Z. Run, job, and log details were retrieved through `tea api`. Checkout reached `HEAD is now at 0a8333b`; clean `npm ci` installed 351 packages, lint passed, all **421 tests in 22 files** passed, and the production build succeeded.

## Final-review hardening fixes

Based at `3981e912d1dd4f3efcc52b933d075e0d611fad94`, the final review produced one small runtime/test fix wave without changing feature scope:

- `src/main.ts` now trims each legacy plaintext key before deciding whether to write it to SecretStorage. A whitespace-only persisted field is still cleared and sanitized settings are still saved, but an existing valid secret is no longer overwritten with an empty string. `tests/secret-storage.test.ts` covers the existing-secret, in-memory, and persisted-data behavior.
- `src/selection-modal.ts` retains its Cancel button and restores `disabled = false` plus `textContent = 'Cancel'` when the owned request settles after Stop. `tests/selection-modal.test.ts` uses a deferred quick-action request to verify abort, the transient `Stopping...` state, and settled controls.
- `tests/chat-view.test.ts` now explicitly proves immediate plain-text loading does not call `MarkdownRenderer.render`. No chat rendering implementation changed.

Focused TDD evidence: the SecretStorage regression first failed because the existing secret became `''`, then passed with all **7 tests** in its file; the deferred Stop regression first failed because Cancel remained disabled, then passed with all **6 tests** in its file. The combined focused run passed **36 tests in 3 files**.

Final local gate: `npm test && npm run lint && npm run build && git diff --check` passed with **423 tests in 22 files**, no ESLint findings, successful strict TypeScript checking and production esbuild, and no whitespace errors. An earlier full-gate attempt caught a zero-argument test-mock tuple at strict TypeScript checking; the mock was typed to the real callback signature before the successful rerun. This fix wave adds no provider transport, note-writing path, setting, protocol, or deferred feature and was verified through automated tests rather than a new real-Obsidian smoke run.
