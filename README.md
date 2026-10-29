# Emend

Emend is an Obsidian plugin for context-aware AI chat and reviewable edits to Markdown notes. It is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek and is being rewritten in stages. See [CREDITS.md](CREDITS.md) for attribution.

## Current features

- DeepSeek, Kimi, and custom OpenAI-compatible providers with editable API keys, base URLs, model names, and reasoning-effort settings.
- Desktop streaming transport with content, reasoning, and token-usage events.
- Context-aware chat with the active Markdown note.
- Chat-only answers and JSON-based edit responses using the temporary legacy protocol.
- In-editor diff previews with whole-preview and per-hunk accept/reject actions.
- Temporary inline suggestions, accepted with `+` and rejected with `-`.
- Optional note-path sharing and a configurable context character limit.

The default-mode setting is saved for the planned mode selector; explicit modes, code-level write permissions, CriticMarkup editing, Track Changes integration, and automatic instruction/skill loading are not wired into the current runtime yet. Chat UI streaming is also still pending: the temporary chat and inline adapters accumulate the streamed response before displaying it.

## Setup and usage

1. Install the plugin as `emend` on desktop Obsidian and enable **Emend** under **Settings → Community plugins**.
2. In Emend settings, choose a provider and enter its API key, HTTP(S) base URL, and model. DeepSeek and Kimi have editable presets; a custom provider requires an OpenAI-compatible base URL.
3. Open **AI chat** from the ribbon or Command Palette. Ask a question for a chat-only answer, or request an edit to review proposed changes in the note.
4. Use **Accept all**, **Reject all**, or the per-hunk actions before any chat edit is written.
5. The legacy **Generate inline AI suggestion** command remains available temporarily.

Emend uses the new `emend` plugin ID and does not migrate Lapis Lazuli settings.

## Privacy

Emend makes no background AI requests. Note content is sent to the selected provider only when you invoke chat or an inline suggestion. API keys and settings are stored locally through Obsidian's plugin data mechanism. The vault and note path are sent only when **Include note path** is enabled.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

The plugin is desktop-only because its OpenAI-compatible transport uses browser `fetch` with Server-Sent Events. It does not use Obsidian's `requestUrl` or a provider-specific fallback transport.
