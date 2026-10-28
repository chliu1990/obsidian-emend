# Emend rewrite roadmap

The rewrite proceeds in 17 stages. Each stage record must contain **Goal**, **Plan**, **Implementation details**, and **Verification results**, with actual command and CI evidence.

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
