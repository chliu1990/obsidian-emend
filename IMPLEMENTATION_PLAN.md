# Implementation Plan: Emend

## Status

Stages 1–16 of the Emend rewrite are implemented and reviewed. Stage 17 is the final documentation, compatibility, manual-verification, and release-candidate stage. This file is now an index to the numbered stage records, not a description of unfinished pseudocode or a second runtime specification.

Current behavior is documented in [README.md](README.md) and [AGENTS.md](AGENTS.md). The complete real-Obsidian release matrix is in [devel_docs/manual-verification.md](devel_docs/manual-verification.md); release-candidate results and CI evidence are in [devel_docs/17-release-candidate.md](devel_docs/17-release-candidate.md).

## Architecture contract

- Emend is desktop-only and requires Obsidian 1.11.4 or newer. DeepSeek, Kimi, and custom HTTP(S) endpoints use one OpenAI-compatible streaming `fetch` transport with Server-Sent Events.
- Ask, Discuss, and Brainstorm have no note writer. Edit and Modify Selection apply validated CriticMarkup immediately after completion, abort, exact-source, active-target, and permission checks. Track Changes is the only review surface.
- The default edit strategy accepts a complete CriticMarkup document or annotated selection. The opt-in Operations strategy accepts a closed JSON command union, validates exact original-snapshot ranges atomically, and compiles into the same CriticMarkup path.
- Full-note Edit sends the complete captured note. Selection editing sends the complete selection plus default smart structural context or the symmetric opt-out; context expansion never expands the replacement target.
- Vault-root `AGENTS.md` and directly referenced skills are loaded for every request, with skills placed before agent instructions. Note paths are shared only when explicitly enabled.
- Ready per-note conversations and token-usage metadata persist locally through versioned atomic storage. Credentials, request bodies, note snapshots, transient messages, and full edit responses are not persisted.
- The Track Changes plugin is required to review accepted annotations. Emend intentionally has no in-plugin Apply/Reject or diff UI.

## Numbered stage records

1. [Testing and CI](devel_docs/01-testing-and-ci.md) — Vitest, Obsidian mocks, Gitea Actions, and stage evidence conventions.
2. [Emend identity and settings](devel_docs/02-emend-identity-settings.md) — clean plugin identity and normalized settings.
3. [Modes and permissions](devel_docs/03-modes-permissions.md) — deterministic modes and code-level write permissions.
4. [Instructions and skills](devel_docs/04-instructions-skills.md) — vault instruction and skill discovery.
5. [Streaming provider](devel_docs/05-streaming-provider.md) — OpenAI-compatible streaming transport.
6. [Read-only chat](devel_docs/06-read-only-chat.md) — streamed chat without note writes.
7. [CriticMarkup engine](devel_docs/07-critic-markup-engine.md) — parsing and sequential validation.
8. [Full-note editing](devel_docs/08-full-note-editing.md) — guarded whole-note writes.
9. [Selection editing](devel_docs/09-selection-editing.md) — exact-range native editor replacement.
10. [Conversation persistence](devel_docs/10-conversation-persistence.md) — versioned, atomic per-note threads.
11. [Multi-turn edits](devel_docs/11-multi-turn-edits.md) — sequential edits and per-note isolation.
12. [Quick actions](devel_docs/12-quick-actions.md) — shared guarded Edit submission flow.
13. [Keyboard shortcuts](devel_docs/13-keyboard-shortcuts.md) — composer and mode shortcuts.
14. [Token usage](devel_docs/14-token-usage.md) — provider usage and labeled estimates.
15. [Smart selection context](devel_docs/15-smart-selection-context.md) — structural context without target expansion.
16. [Operation-based editing](devel_docs/16-operation-based-editing.md) — validated closed JSON operations.
17. [Release candidate](devel_docs/17-release-candidate.md) — final compatibility review, full verification matrix, and 2.0.0 metadata.

## Verification and release process

Run the clean local gate from the repository root:

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

Real-Obsidian verification uses only the ignored `test_vault/`, Track Changes, a local OpenAI-compatible SSE mock, and dummy credentials. It must not use real provider accounts, paid calls, or other vaults.

CI runs lint, tests, and the production build on the dedicated `emend-macos` label, dispatched to `emend-macos-docker`. A release is published manually only after the release-candidate evidence is complete; Stage 17 does not publish one. For a later release, `npm version <patch|minor|major>` synchronizes `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`. Release assets are `main.js`, `manifest.json`, and `styles.css`, with a tag exactly matching the manifest version and no leading `v`.
