# Emend

Emend is an Obsidian plugin for context-aware, streamed AI chat and guarded CriticMarkup editing of Markdown notes. It is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek and is being rewritten in stages. See [CREDITS.md](CREDITS.md) for attribution.

## Current features

- DeepSeek, Kimi, and custom OpenAI-compatible providers with editable API keys, base URLs, model names, and reasoning-effort settings.
- Streamed Ask, Discuss, and Brainstorm responses in the chat sidebar. These modes never write to the note.
- Guarded full-note Edit mode: the complete note is buffered privately, validated as CriticMarkup, checked against the captured file and target, and written once with `vault.modify` when the response completes.
- Immediate edit confirmations in chat, with the annotated document kept out of chat history. Unchanged responses do not write; valid comment-only edits may write with zero text changes.
- Track Changes as the only edit-review surface. Emend has no Apply/Reject or in-plugin diff UI.
- Per-session mode controls, mode badges and placeholders, model labels, response copying, and Stop for an in-flight request.
- Markdown responses rendered with the captured note as the source path, including links and Obsidian-supported math. Reasoning is shown separately in a closed details section.
- Bounded note context centered on the selection or caret for read-only modes, optional note-path sharing, and a configurable context character limit. Edit always sends the complete note regardless of this limit.
- Vault-root `AGENTS.md` instructions and directly referenced skills loaded for each request.

Selection-only editing is not yet available.

## Setup and usage

1. Install the plugin as `emend` on desktop Obsidian and enable **Emend** under **Settings → Community plugins**.
2. In Emend settings, choose a provider and enter its API key, HTTP(S) base URL, and model. DeepSeek and Kimi have editable presets; a custom provider requires an OpenAI-compatible base URL.
3. Open **AI chat** from the ribbon or Command Palette. Choose Ask, Discuss, Brainstorm, or Edit, enter a prompt, and select **Send**.
4. Watch chat responses and folded reasoning stream. Use **Copy** for completed content or **Stop** to abort the request.
5. In Edit mode, review the validated CriticMarkup written to the note with the Track Changes plugin. Chat reports only the result summary. If the note or target changes while the response is pending, Emend applies nothing.
6. Change the selected mode at any time when no request is running. Switching notes does not reset the session's selected mode.

Emend uses the new `emend` plugin ID and does not migrate Lapis Lazuli settings.

## Privacy

Emend makes no background AI requests. Read-only modes send bounded note content; an explicit Edit action sends the complete note regardless of the context limit. The prompt, recent ready chat messages, vault-root `AGENTS.md`, and directly referenced skill instructions are also sent to the selected provider. API keys and settings are stored locally through Obsidian's plugin data mechanism. The vault and note path are sent only when **Include note path** is enabled.

Only Edit has a note-writing path. It writes validated CriticMarkup immediately after completion and target/source checks; Track Changes provides subsequent review.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

The plugin is desktop-only because its OpenAI-compatible transport uses browser `fetch` with Server-Sent Events. It does not use Obsidian's `requestUrl` or a provider-specific fallback transport.
