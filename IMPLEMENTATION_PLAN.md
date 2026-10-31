# Implementation Plan: Emend

## Status

Stages 1–22 of the Emend rewrite are implemented and reviewed. This file is an index to the numbered stage records, not a description of unfinished pseudocode or a second runtime specification.

Current behavior is documented in [README.md](README.md) and [AGENTS.md](AGENTS.md). The original real-Obsidian release matrix is in [devel_docs/manual-verification.md](devel_docs/manual-verification.md); release-candidate results and CI evidence are in [devel_docs/17-release-candidate.md](devel_docs/17-release-candidate.md), and the hardened release smoke matrix is in [devel_docs/22-release-verification.md](devel_docs/22-release-verification.md). Historical records retain the behavior and evidence from their own stages.

Deferred, unimplemented work is specified separately in [future-context-management.md](devel_docs/future-context-management.md) and [future-web-search.md](devel_docs/future-web-search.md). Those documents do not change current request, context, privacy, or provider behavior.

## Architecture contract

- Emend is desktop-only and requires Obsidian 1.11.4 or newer. DeepSeek `deepseek-flash` at `https://api.deepseek.com`, Kimi `k3.1-pro` at `https://api.kimi.com/coding/v1`, and custom HTTP(S) endpoints use one OpenAI-compatible streaming `fetch` transport with Server-Sent Events. Preset URLs and models remain editable.
- Ask, Discuss, and Brainstorm have no note writer. Edit and Modify Selection apply validated CriticMarkup immediately after completion, abort, exact-source, active-target, and permission checks. Track Changes is the only review surface.
- Operations are the only model-facing edit protocol. The closed JSON command union validates exact original-snapshot ranges atomically and compiles into the internal CriticMarkup path; there is no edit-strategy setting.
- Full-note Edit sends the complete captured note. Selection editing sends the complete selection plus default smart structural context or the symmetric opt-out; context expansion never expands the replacement target.
- Vault-root `AGENTS.md` and directly referenced skills are loaded for every request, with skills placed before agent instructions. Note paths are shared only when explicitly enabled.
- Ready per-note conversations and token-usage metadata persist locally through versioned atomic storage. Provider credentials persist separately in Obsidian SecretStorage, while plugin `data.json` keeps every `apiKey` empty. Request bodies, note snapshots, transient messages, and full edit responses are not persisted.
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
18. [Chat presentation](devel_docs/18-chat-presentation.md) — streamed Markdown presentation and timing evidence.
19. [Provider metadata](devel_docs/19-provider-metadata.md) — current provider presets and publication metadata.
20. [Operations-only editing and selection actions](devel_docs/20-operations-selection-actions.md) — one model-facing protocol and shared selection quick actions.
21. [SecretStorage API keys](devel_docs/21-secret-storage.md) — provider credential migration, request resolution, and sanitized settings persistence.
22. [Release verification](devel_docs/22-release-verification.md) — deferred roadmap, current guides, hardened-release smoke matrix, reviews, and final CI evidence.

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

GitHub Actions runs lint, tests, and the production build through `.github/workflows/ci.yaml` on `ubuntu-latest` with Node 24. For a later release, `npm version <patch|minor|major>` synchronizes `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`. Create or dispatch a tag that exactly matches the manifest version, without a leading `v`; `.github/workflows/release.yaml` verifies it and publishes `main.js`, `manifest.json`, and `styles.css` as individual GitHub release assets after all checks pass.
