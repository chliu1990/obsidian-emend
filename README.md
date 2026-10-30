# Emend

Emend is an Obsidian plugin for context-aware, streamed AI chat and guarded CriticMarkup editing of Markdown notes. It is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek and is being rewritten in stages. See [CREDITS.md](CREDITS.md) for attribution.

## Current features

- DeepSeek, Kimi, and custom OpenAI-compatible providers with editable API keys, base URLs, model names, and reasoning-effort settings.
- Streamed Ask, Discuss, and Brainstorm responses in the chat sidebar. These modes never write to the note.
- Guarded full-note Edit mode: the complete note is buffered privately, validated as CriticMarkup, checked against the captured file and target, and written once with `vault.modify` when the response completes.
- Explicit **Modify selected text with AI**: the complete selection and bounded surrounding context are sent after an instruction is submitted. The validated annotated selection replaces only the captured editor range with native undo support.
- Immediate edit confirmations, with annotated documents and selections kept out of chat history. Unchanged responses do not write; valid comment-only edits may write with zero text changes.
- Sequential multi-turn edits use the latest annotated note while preserving earlier Track Changes markup. A shared per-note pending guard prevents full-note, read-only chat, and selection requests from racing; different notes remain independent.
- Track Changes as the only edit-review surface. Emend has no Apply/Reject or in-plugin diff UI.
- Per-session mode controls, mode badges and placeholders, model labels, response copying, and Stop for an in-flight request.
- Composer and mode keyboard shortcuts: Enter or Mod+Enter sends, Shift+Enter inserts a newline, and Mod+Shift+A/E selects Ask/Edit without submitting. Obsidian maps Mod to Cmd on macOS and Ctrl on Windows/Linux.
- **Fix grammar**, **Make concise**, and **Add examples** quick actions above the composer. Each submits a visible prompt through the normal guarded Edit flow, including history, persistence, pending isolation, and write validation.
- Versioned per-note conversation persistence with atomic local writes, rapid-note-switch protection, and safe recovery of malformed thread files.
- Markdown responses rendered with the captured note as the source path, including links and Obsidian-supported math. Reasoning is shown separately in a closed details section.
- Bounded note context centered on the selection or caret for read-only modes, optional note-path sharing, and a configurable context character limit. Selection editing bounds only the surrounding context and never truncates the selection; full-note Edit always sends the complete note.
- Vault-root `AGENTS.md` instructions and directly referenced skills loaded for each request.

## Setup and usage

1. Install the plugin as `emend` on desktop Obsidian and enable **Emend** under **Settings → Community plugins**.
2. In Emend settings, choose a provider and enter its API key, HTTP(S) base URL, and model. DeepSeek and Kimi have editable presets; a custom provider requires an OpenAI-compatible base URL.
3. Open **AI chat** from the ribbon or Command Palette. Choose Ask, Discuss, Brainstorm, or Edit, enter a prompt, and select **Send**. Press **Enter** or **Cmd+Enter** on macOS (**Ctrl+Enter** on Windows/Linux) to send; **Shift+Enter** inserts a newline without sending.
4. Press **Cmd+Shift+A** or **Cmd+Shift+E** on macOS (**Ctrl+Shift+A/E** on Windows/Linux), or run **Switch to ask mode** / **Switch to edit mode** from the Command Palette. These commands open or focus chat, show the selected mode, and preserve the current draft without submitting, making a provider request, or writing the note. A mode change during a pending request applies only to the next request.
5. Select **Fix grammar**, **Make concise**, or **Add examples** above the composer for a common edit. The action switches to Edit and submits its visible prompt once through the normal guarded flow. Actions are disabled without a usable note and while a request or thread load is pending.
6. Watch chat responses and folded reasoning stream. Use **Copy** for completed content or **Stop** to abort the request.
7. In Edit mode, review the validated CriticMarkup written to the note with the Track Changes plugin. Chat reports only the result summary. Follow-up edits start from the latest annotated note and retain earlier markup. If the note or target changes while a response is pending, Emend applies nothing. A second request for that note reports `Wait for the current Emend request to finish.`; Stop, errors, and completion release the note for retry. The single chat view still submits one UI request at a time.
8. To edit only part of a note, select nonempty text and run **Modify selected text with AI** from the Command Palette. Enter an instruction and select **Modify selection**. Cancel or close the modal to abort a pending request.
9. Review the selection's CriticMarkup in Track Changes, or use Cmd/Ctrl+Z to undo its single native editor replacement. Invalid, aborted, stale, or target-switched requests replace nothing.
10. Switching notes loads that note's saved thread without resetting the session's selected mode. Reloading Obsidian restores saved conversations.

Emend uses the new `emend` plugin ID and does not migrate Lapis Lazuli settings.

## Privacy

Emend makes no background AI requests. Note content is sent only when you explicitly submit a chat or selection-edit action. Read-only modes send bounded note content; full-note Edit sends the complete note regardless of the context limit. Modify Selection sends the complete selected text plus bounded before/after context, even when the selection itself exceeds that limit. The prompt, recent ready chat messages for chat requests, vault-root `AGENTS.md`, and directly referenced skill instructions are also sent to the selected provider. API keys and settings are stored locally through Obsidian's plugin data mechanism. The vault and note path are sent only when **Include note path** is enabled.

Ready user and assistant messages are saved locally under `<configDir>/emend/chats/`, with SHA-256 note-path keys and bounded readable filenames. Saving a thread sends nothing to a provider. Loading, stopped, and error messages, API keys, note snapshots, request bodies, and buffered edit responses are not persisted; Edit history keeps only concise result summaries. A malformed thread is left untouched when read and copied to a single `.corrupt` backup before the next save replaces it. Unsupported schema versions are not overwritten. Deleting a note does not automatically delete its stored thread or corrupt backup.

Only full-note Edit and explicit Modify Selection have note-writing paths. They write validated CriticMarkup immediately after completion and target/source checks; Track Changes provides subsequent review.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

The plugin is desktop-only because its OpenAI-compatible transport uses browser `fetch` with Server-Sent Events. It does not use Obsidian's `requestUrl` or a provider-specific fallback transport.
