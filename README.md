# Emend

Emend is a desktop Obsidian plugin for context-aware, streamed AI chat and guarded Operations-based editing of Markdown notes with Track Changes review. It is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek and has been rewritten around explicit modes, validated edits, and Track Changes review. See [CREDITS.md](CREDITS.md) for attribution.

## Current features

- DeepSeek, Kimi, and custom OpenAI-compatible providers with editable API keys, base URLs, model names, and reasoning-effort settings.
- Streamed Ask, Discuss, and Brainstorm responses in the chat sidebar. These modes never write to the note.
- Guarded full-note Edit mode: the complete note is buffered privately, validated as closed JSON operations, compiled into CriticMarkup, checked against the captured file and target, and written once with `vault.modify` when the response completes.
- **Operations** is the only model-facing edit protocol: closed JSON insert/remove/replace/comment commands use exact original anchors, occurrence disambiguation, and atomic ambiguity/overlap validation before compiling into the same CriticMarkup and Track Changes path. There is no edit-strategy setting.
- Explicit **Modify selected text with AI**: the complete selection and bounded surrounding context are sent after an instruction or shared quick action is submitted. The validated annotated selection replaces only the captured editor range with native undo support.
- Smart selection context expands requests to containing paragraphs and then whole adjacent paragraphs within the context budget, with deliberate YAML-frontmatter and fenced-code handling. Expansion never changes the selection or replacement offsets; the setting can be disabled for Stage 09 symmetric before/after context.
- Immediate edit confirmations, with annotated documents and selections kept out of chat history. Unchanged responses do not write; valid comment-only edits may write with zero text changes.
- Sequential multi-turn edits use the latest annotated note while preserving earlier Track Changes markup. A shared per-note pending guard prevents full-note, read-only chat, and selection requests from racing; different notes remain independent.
- Track Changes as the only edit-review surface. Emend has no Apply/Reject or in-plugin diff UI.
- Per-session mode controls, mode badges and placeholders, model labels, response copying, and Stop for an in-flight request.
- Completed assistant footers show provider-reported token usage or a clearly labeled character-based estimate, including concise Edit confirmations. Usage persists with the local conversation after reload.
- Composer and mode keyboard shortcuts: Enter or Mod+Enter sends, Shift+Enter inserts a newline, and Mod+Shift+A/E selects Ask/Edit without submitting. Obsidian maps Mod to Cmd on macOS and Ctrl on Windows/Linux.
- **Fix grammar**, **Make concise**, and **Add examples** quick actions above the composer and in the selection modal. Each submits its exact prompt once through the corresponding guarded Edit flow, with pending isolation and write validation.
- Versioned per-note conversation persistence with atomic local writes, rapid-note-switch protection, and safe recovery of malformed thread files.
- Markdown responses rendered with the captured note as the source path, including links and Obsidian-supported math. Reasoning is shown separately in a closed details section.
- Bounded note context centered on the selection or caret for read-only modes, optional note-path sharing, and a configurable context character limit. Selection editing bounds only the surrounding context and never truncates the selection; full-note Edit always sends the complete note.
- Vault-root `AGENTS.md` instructions and directly referenced skills loaded for each request.

## Documentation

- [Installation guide](INSTALLATION.md) — build from source, install into a vault, update, remove, and troubleshoot Emend.
- [Quick start](QUICK_START.md) — configure a provider and test chat, Track Changes editing, selection editing, persistence, and skills.

## Setup and usage

1. Use desktop Obsidian 1.11.4 or newer and install/enable the Track Changes plugin for edit review. For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/emend/`, then enable **Emend** under **Settings → Community plugins**. Mobile is not supported.
2. In Emend settings, choose a provider and enter its API key, HTTP(S) base URL, and model. DeepSeek and Kimi have editable presets; a custom provider requires an OpenAI-compatible base URL. **Request token usage** is enabled by default for DeepSeek/Kimi and disabled for custom providers. Disable it if a provider rejects `stream_options`; Emend reports the error and does not retry automatically.
3. Open **Emend chat** from the ribbon or Command Palette. Choose Ask, Discuss, Brainstorm, or Edit, enter a prompt, and select **Send**. Press **Enter** or **Cmd+Enter** on macOS (**Ctrl+Enter** on Windows/Linux) to send; **Shift+Enter** inserts a newline without sending.
4. Press **Cmd+Shift+A** or **Cmd+Shift+E** on macOS (**Ctrl+Shift+A/E** on Windows/Linux), or run **Switch to ask mode** / **Switch to edit mode** from the Command Palette. These commands open or focus chat, show the selected mode, and preserve the current draft without submitting, making a provider request, or writing the note. A mode change during a pending request applies only to the next request.
5. Select **Fix grammar**, **Make concise**, or **Add examples** above the composer for a common edit. The action switches to Edit and submits its visible prompt once through the normal guarded flow. Actions are disabled without a usable note and while a request or thread load is pending.
6. Watch chat responses and folded reasoning stream. Use **Copy** for completed content or **Stop** to abort the request.
7. In Edit mode, review the validated CriticMarkup written to the note with the Track Changes plugin. Every edit requests a bare JSON array of insert, remove, replace, or comment commands instead of a rewritten document; Operations is the only model-facing protocol and there is no strategy selector. Anchors and targets must exactly match the captured source; repeated text requires a one-based `occurrence`, and ambiguous, overlapping, malformed, or markup-injecting operations apply nothing. Chat reports only the result summary. Follow-up edits start from the latest annotated note and retain earlier markup. If the note or target changes while a response is pending, Emend applies nothing. A second request for that note reports `Wait for the current Emend request to finish.`; Stop, errors, and completion release the note for retry. The single chat view still submits one UI request at a time.
8. To edit only part of a note, select nonempty text and run **Modify selected text with AI** from the Command Palette. Enter an instruction and select **Modify selection**, or select **Fix grammar**, **Make concise**, or **Add examples** in the modal to submit that exact shared prompt without typing. All quick actions use the same selection submission path and are disabled while pending. **Smart selection context** is enabled by default: Emend sends the containing paragraph(s), then whole adjacent paragraphs that fit the context character limit. YAML frontmatter and fenced code are kept as complete structural blocks when they fit; over-budget containing blocks use marked, deterministic context truncation without truncating the selection. Disable the setting to restore symmetric before/after context. Cancel or close the modal to abort a pending request.
9. Review the selection's CriticMarkup in Track Changes, or use Cmd/Ctrl+Z to undo its single native editor replacement. Smart context changes only the request context, never the captured replacement range. Invalid, aborted, stale, or target-switched requests replace nothing.
10. Switching notes loads that note's saved thread without resetting the session's selected mode. Reloading Obsidian restores saved conversations.

Emend uses the new `emend` plugin ID and does not migrate Lapis Lazuli settings.

## Privacy

Emend makes no background AI requests. Note content is sent only when you explicitly submit a chat or selection-edit action. Read-only modes send bounded note content; full-note Edit sends the complete note regardless of the context limit. Modify Selection always sends the complete selected text, even when it exceeds the context limit. By default, surrounding context expands to containing and adjacent structural paragraphs within the source-character budget, with `[...]` markers at omissions; disabling **Smart selection context** restores bounded symmetric before/after context. The prompt, recent ready chat messages for chat requests, vault-root `AGENTS.md`, and directly referenced skill instructions are also sent to the selected provider. API keys and settings are stored locally through Obsidian's plugin data mechanism. The vault and note path are sent only when **Include note path** is enabled.

Ready user and assistant messages are saved locally under `<configDir>/emend/chats/`, with SHA-256 note-path keys and bounded readable filenames. Saving a thread sends nothing to a provider. Loading, stopped, and error messages, API keys, note snapshots, request bodies, and buffered edit responses are not persisted; Edit history keeps only concise result summaries. A malformed thread is left untouched when read and copied to a single `.corrupt` backup before the next save replaces it. Unsupported schema versions are not overwritten. Deleting a note does not automatically delete its stored thread or corrupt backup.

Completed assistant usage counts and their provider/estimated source are saved with ready messages. Estimates use `max(1, ceil(characters / 4))` separately for request and response text; they are not provider billing data. Emend adds no pricing, tokenizer, or model-metadata network calls.

Only full-note Edit and explicit Modify Selection have note-writing paths. They write validated CriticMarkup immediately after completion and target/source checks; Track Changes provides subsequent review.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

The plugin is desktop-only because its OpenAI-compatible transport uses browser `fetch` with Server-Sent Events. It does not use Obsidian's `requestUrl` or a provider-specific fallback transport.

## Vibecoding credit

This project was driven by vibecoding with **Kimi K3.1 Pro** using **Kimi Code**.
