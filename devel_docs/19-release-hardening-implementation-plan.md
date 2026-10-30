# Emend Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the current PR with reliable streaming, current provider presets, Operations-only editing, selection quick actions, secure API-key storage, and explicit deferred-roadmap documents.

**Architecture:** Keep each change behind the existing request and write guards. Operations compiles into the internal CriticMarkup validator/Track Changes path, while Obsidian `SecretStorage` owns provider credentials and plugin `data.json` contains only sanitized settings.

**Tech Stack:** TypeScript strict, Obsidian 1.11.4 `SecretStorage`, Vitest, esbuild, real Obsidian timed-SSE/manual verification, Gitea Actions on `emend-macos-docker`.

## Global Constraints

- Design contract: `devel_docs/18-release-hardening-design.md`.
- Work on `feat/emend-rewrite`; preserve all previously reviewed behavior and do not merge or publish automatically.
- DeepSeek preset: `deepseek-flash` at `https://api.deepseek.com`. Kimi Code preset: `k3.1-pro` at `https://api.kimi.com/coding/v1`.
- Author: `Chang Liu and Kimi K3.1 Pro`. Remove the original `authorUrl` until a real public maintainer/project URL exists; retain original copyright and CREDITS attribution.
- Operations is the only model-facing edit protocol. Internal CriticMarkup parsing/validation remains because Track Changes consumes it.
- Secret IDs are exactly `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom`. Never persist plaintext keys in `data.json`, logs, tests, reports, or conversations.
- Defer context token accounting/progress bars, automatic context compression, and online search to their own roadmap documents; do not implement them in these tasks.
- Every task creates `devel_docs/NN-short-name.md` with Goal, Plan, Implementation details, Verification results; follows TDD; commits/pushes; receives task review; and finishes with green Gitea CI on `emend-macos-docker`.
- Full local gate for every task: `npm test`, `npm run lint`, `npm run build`, `git diff --check`.

---

### Task 1: Stage 18 chat presentation and timed streaming

**Files:**
- Modify `src/chat-view.ts`, `src/main.ts`, `styles.css`, `tests/chat-view.test.ts`, `README.md`, `QUICK_START.md`.
- Create `devel_docs/18-chat-presentation.md` and ignored timed-SSE verification helpers only under `test_vault/`.

**Interfaces:**
- Preserve existing `EmendChatView` submission/callback contracts.
- Loading messages display plain text immediately; ready/stopped messages use `MarkdownRenderer`.
- `getDisplayText()` returns `Emend`; ribbon/command text is `Open Emend chat`.

- [ ] **Step 1: Confirm focused red evidence.** Run `npx vitest run tests/chat-view.test.ts` against the pre-fix implementation if not already recorded. Expected: display name and immediate-loading regressions fail with `AI chat` and an empty loading body.
- [ ] **Step 2: Confirm minimal implementation green.** Keep immediate plain-text loading and final Markdown rendering. Run `npx vitest run tests/chat-view.test.ts`; expected all tests pass.
- [ ] **Step 3: Add hover regressions and implement readable hover states.** Require explicit rules for `.emend-chat-mode-button:hover` and `.emend-chat-mode-button.is-active:hover`, with `color: var(--text-normal)` and distinct hover backgrounds. Do not use a light accent with unreadable text.
- [ ] **Step 4: Verify real timed streaming.** In an isolated Obsidian/test-vault instance, serve four SSE content chunks 500 ms apart. Sample the assistant body at 250 ms intervals. Expected: intermediate samples contain increasing prefixes before the final chunk; title is Emend; final Markdown is rendered after completion. Close only the isolated process and stop the mock.
- [ ] **Step 5: Gate, document, commit, and review.** Run the full gate, write Stage 18 evidence, commit `fix: show streamed chat immediately`, push, and verify CI. Task reviewer must approve presentation and lack of rendering races.

### Task 2: Stage 19 provider presets and author metadata

**Files:**
- Modify `src/settings.ts`, `tests/settings.test.ts`, `manifest.json`, `package.json`, `package-lock.json`, `devel_docs/19-provider-metadata.md`.
- Modify provider examples in `README.md`, `QUICK_START.md`, and `AGENTS.md` only where stale.

**Interfaces:**
- `DEFAULT_SETTINGS.providers.deepseek.model === 'deepseek-flash'`.
- `DEFAULT_SETTINGS.providers.kimi.model === 'k3.1-pro'`.
- `DEFAULT_SETTINGS.providers.kimi.baseUrl === 'https://api.kimi.com/coding/v1'`.

- [ ] **Step 1: Write failing preset/metadata tests.** Assert exact DeepSeek/Kimi defaults, retained custom-provider behavior, valid persisted model overrides, manifest author `Chang Liu and Kimi K3.1 Pro`, package author equality, and absence of the original `authorUrl`. Run `npx vitest run tests/settings.test.ts`; expected preset failures.
- [ ] **Step 2: Implement only the new defaults and metadata.** Update package lock metadata through npm rather than hand-editing inconsistent versions. Keep version `2.0.0` and all other behavior unchanged. Run focused tests; expected pass.
- [ ] **Step 3: Verify source-backed configuration and gate.** Confirm values against the DeepSeek/Kimi URLs cited in the design. Run full gate and write actual stage evidence.
- [ ] **Step 4: Commit and review.** Commit `fix: update provider presets and author metadata`, push, verify CI, and obtain task review.

### Task 3: Stage 20 Operations-only editing and selection quick actions

**Files:**
- Modify `src/edit-strategy.ts`, `src/mode.ts`, `src/settings.ts`, `src/types.ts`, `src/selection-modal.ts`, `src/main.ts` only where strategy/settings wiring requires it.
- Modify `tests/mode.test.ts`, `tests/settings.test.ts`, `tests/operation-edit-strategy.test.ts`, `tests/selection-editor.test.ts`, and quick-action/selection-modal tests.
- Create `tests/selection-modal.test.ts` if no suitable suite exists and `devel_docs/20-operations-selection-actions.md`.
- Do not delete `src/critic-markup.ts`; it remains internal infrastructure.

**Interfaces:**
- `getEditStrategy()` always returns `operationEditStrategy` with no settings argument.
- Persisted settings no longer contain `editStrategy`; old values normalize to an Operations-only settings object.
- Selection modal reuses `QUICK_ACTIONS`; `submit(prompt)` remains the only submission path.

- [ ] **Step 1: Write failing strategy-removal tests.** Assert settings have no strategy field, the factory always returns Operations, read-only prompts remain unchanged, and no CriticMarkup model-facing prompt path remains. Run focused tests; expected failures from the old setting/factory/prompts.
- [ ] **Step 2: Implement Operations-only wiring.** Remove the CriticMarkup strategy object, strategy setting/UI, and model-facing CriticMarkup prompt builders. Preserve internal `prepareCriticMarkupEdit`, operation compilation, full/selection write guards, and existing markup preservation. Run focused tests; expected pass.
- [ ] **Step 3: Write failing selection quick-action tests.** Each existing action ID submits its exact prompt once through selection submission, requires no typed input, disables during pending, and re-enables on settlement. Provider/validation failures must not write. Run tests; expected missing-button failures.
- [ ] **Step 4: Implement selection quick actions.** Render Fix grammar, Make concise, and Add examples in the modal and route clicks through `submit(action.prompt)`. Run focused and full gates.
- [ ] **Step 5: Verify real editing and commit.** In real Obsidian with a local SSE mock, test all three selection buttons, Operations full-note editing, old-settings normalization, invalid operations with no write, Track Changes cards, and native undo. Write stage evidence, commit `feat: simplify editing and add selection actions`, push, verify CI, and obtain task review.

### Task 4: Stage 21 SecretStorage API keys

**Files:**
- Create `src/secret-storage.ts` if a focused adapter improves testing, `tests/secret-storage.test.ts`, `devel_docs/21-secret-storage.md`.
- Modify `src/main.ts`, `src/settings.ts`, `tests/main.test.ts`, `tests/settings.test.ts`, Obsidian test mocks, and current privacy docs only as needed.

**Interfaces:**
- `getApiKey(providerId): string` resolves from `app.secretStorage` with an in-memory fallback.
- `setApiKey(providerId, value): Promise<void>` writes SecretStorage and saves sanitized settings.
- `sanitizeSettings(settings): EmendSettings` returns a deep provider-config clone whose every `apiKey` is empty.
- Secret IDs follow the Global Constraints exactly.

- [ ] **Step 1: Write failing migration/security tests.** Cover first plaintext migration, all three providers, subsequent saves, reload resolution, empty keys, independent updates, deep-clone behavior, and proof that `saveData()` never receives a nonempty `apiKey`. Run `npx vitest run tests/secret-storage.test.ts tests/main.test.ts tests/settings.test.ts`; expected failures because plaintext currently persists.
- [ ] **Step 2: Implement the storage boundary and migration.** On load, migrate plaintext into SecretStorage, clear it in memory, and save sanitized settings. Resolve request keys from SecretStorage. Settings inputs remain masked and use get/set helpers. Every save serializes a sanitized clone rather than trusting the caller. Run focused tests; expected pass.
- [ ] **Step 3: Verify real migration without exposing secrets.** In isolated Obsidian, seed only dummy plaintext keys, load Emend, inspect sanitized `data.json` programmatically without printing secrets, confirm all three SecretStorage IDs resolve after reload, save again, and confirm plaintext remains absent. Do not modify real user vault data.
- [ ] **Step 4: Gate, document, commit, and review.** Run full gate, write Stage 21 evidence, commit `feat: store provider keys in SecretStorage`, push, verify CI, and obtain task review.

### Task 5: Stage 22 deferred roadmap and final verification

**Files:**
- Create `devel_docs/future-context-management.md`, `devel_docs/future-web-search.md`, `devel_docs/22-release-verification.md`.
- Modify `README.md`, `QUICK_START.md`, `INSTALLATION.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `devel_docs/00-roadmap.md`.

**Interfaces:**
- Documentation describes Operations-only editing, SecretStorage, new presets, and deferred features accurately. No runtime feature changes are allowed in this task.

- [ ] **Step 1: Record context-management requirements.** Document per-provider context/output limits, honest estimated versus provider usage, a system/note-history/user/output progress bar, default 75% compression threshold, explicit cost/privacy behavior, no silent full-note truncation, and Modify Selection fallback.
- [ ] **Step 2: Record online-search requirements.** Document provider-specific capability detection, opt-in behavior, citations, errors, privacy, and tests. No background searches or shared-schema assumptions.
- [ ] **Step 3: Update current guides.** Remove instructions for selecting CriticMarkup strategy, describe Operations-only behavior and new presets, explain SecretStorage and uninstall/key cleanup implications, and link roadmap documents. Update roadmap/stage index without rewriting historical records.
- [ ] **Step 4: Run final verification.** Run `npm ci && npm test && npm run lint && npm run build && git diff --check`. Run the real Obsidian smoke matrix for title/streaming, provider preset labels, all three selection actions, Operations editing/Track Changes, SecretStorage migration, and reload persistence. Record only observed results.
- [ ] **Step 5: Commit and complete.** Commit `docs: prepare hardened release and future roadmap`, push, verify final CI, and obtain task review plus a whole-change review. Do not merge or publish.

## Completion Criteria

All five tasks are implemented, reviewed, documented, committed, and green in CI; plaintext API keys are absent from migrated settings; Operations is the only model-facing edit protocol; timed streaming is visibly incremental in real Obsidian; and both deferred features have actionable roadmap documents without being included in the current PR.
