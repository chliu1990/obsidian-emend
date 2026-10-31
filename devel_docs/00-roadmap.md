# Emend rewrite roadmap

For current priorities and the rolling release plan, see the public [ROADMAP.md](../ROADMAP.md). Historical stage records remain below.

Stages 1–22 are implemented and reviewed. Each stage record contains **Goal**, **Plan**, **Implementation details**, and **Verification results**, with actual command and CI evidence. The original real-Obsidian release matrix is recorded in [Manual verification](manual-verification.md), and the hardened release smoke matrix is in [Stage 22](22-release-verification.md). Historical records remain unchanged descriptions of their own stage behavior.

1. [Testing and CI](01-testing-and-ci.md) — establish Vitest, the Obsidian mock, Gitea Actions, and the stage documentation convention.
2. [Emend identity and settings](02-emend-identity-settings.md) — migrate the plugin identity and normalize the Emend settings model.
3. [Modes and permissions](03-modes-permissions.md) — add deterministic agent modes and enforce code-level write permissions.
4. [Instructions and skills](04-instructions-skills.md) — load agent instructions and discover dynamic skills.
5. [Streaming provider](05-streaming-provider.md) — implement the plain-text streaming provider protocol.
6. [Read-only chat](06-read-only-chat.md) — support chat responses without note writes in read-only modes.
7. [CriticMarkup engine](07-critic-markup-engine.md) — parse and apply CriticMarkup-native edit operations.
8. [Full-note editing](08-full-note-editing.md) — implement permission-gated whole-note edits through Track Changes.
9. [Selection editing](09-selection-editing.md) — apply AI edits to the current selection with the same review model.
10. [Conversation persistence](10-conversation-persistence.md) — persist and restore chat conversations safely.
11. [Multi-turn edits](11-multi-turn-edits.md) — support iterative edits with conversation context.
12. [Quick actions](12-quick-actions.md) — add reusable actions for common correction tasks.
13. [Keyboard shortcuts](13-keyboard-shortcuts.md) — add configurable keyboard access to core workflows.
14. [Token usage](14-token-usage.md) — surface provider token usage where available.
15. [Smart selection context](15-smart-selection-context.md) — select bounded, relevant note context for requests.
16. [Operation-based editing](16-operation-based-editing.md) — generalize editing around explicit operations.
17. [Release candidate](17-release-candidate.md) — complete release validation, documentation, and packaging.
18. [Chat presentation](18-chat-presentation.md) — immediate plain-text loading, final Markdown rendering, Emend presentation, and timed-stream evidence.
19. [Provider metadata](19-provider-metadata.md) — DeepSeek `deepseek-flash`, Kimi `k3.1-pro`, current endpoints, and publication metadata.
20. [Operations-only editing and selection actions](20-operations-selection-actions.md) — one model-facing protocol and shared selection quick actions.
21. [SecretStorage API keys](21-secret-storage.md) — provider credential migration, request resolution, and sanitized persistence.
22. [Release verification](22-release-verification.md) — deferred roadmap, current guides, final local and real-Obsidian smoke evidence, review, and CI.

## Publication

- [Publication and distribution](publication.md): public GitHub repository, manual installation, release workflow/assets, and the decision not to submit to the Obsidian Community Directory at this time.

## Deferred roadmap — not implemented

- [Context management](future-context-management.md): per-provider context/output limits, honest estimated versus provider usage, category progress display, a configurable 75% compression threshold, explicit privacy/cost behavior, no silent full-note truncation, and Modify Selection fallback.
- [Web search](future-web-search.md): provider-specific capability detection and schemas, explicit opt-in, citations, errors, privacy, and tests, with no background searches or universal-schema assumption.
- [Provider and context improvements](future-provider-and-context-features.md): explicit provider model-list discovery, vision support for embedded note images, and user-selected additional notes as read-only request context.

These designs authorize no current runtime behavior. Their implementation requires separate reviewed changes and verification.
