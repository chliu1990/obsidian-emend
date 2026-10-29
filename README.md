# Emend

Emend is an Obsidian plugin for context-aware, streamed AI chat with Markdown notes. It is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek and is being rewritten in stages. See [CREDITS.md](CREDITS.md) for attribution.

## Current features

- DeepSeek, Kimi, and custom OpenAI-compatible providers with editable API keys, base URLs, model names, and reasoning-effort settings.
- Streamed Ask, Discuss, and Brainstorm responses in the chat sidebar. These modes never write to the note.
- Per-session mode controls, mode badges and placeholders, model labels, response copying, and Stop for an in-flight request.
- Markdown responses rendered with the captured note as the source path, including links and Obsidian-supported math. Reasoning is shown separately in a closed details section.
- Bounded note context centered on the selection or caret, optional note-path sharing, and a configurable context character limit.
- Vault-root `AGENTS.md` instructions and directly referenced skills loaded for each request.

Guarded Edit mode, CriticMarkup editing, and Track Changes integration are still pending. The current chat has no note-writing path, inline suggestions, JSON response protocol, or active diff-preview flow.

## Setup and usage

1. Install the plugin as `emend` on desktop Obsidian and enable **Emend** under **Settings → Community plugins**.
2. In Emend settings, choose a provider and enter its API key, HTTP(S) base URL, and model. DeepSeek and Kimi have editable presets; a custom provider requires an OpenAI-compatible base URL.
3. Open **AI chat** from the ribbon or Command Palette. Choose Ask, Discuss, or Brainstorm, enter a prompt, and select **Send**.
4. Watch the response stream into chat. Expand **Reasoning** when present, use **Copy** for completed content, or select **Stop** to abort the request.
5. Change the selected mode at any time when no request is running. Switching notes does not reset the session's selected mode.

Emend uses the new `emend` plugin ID and does not migrate Lapis Lazuli settings.

## Privacy

Emend makes no background AI requests. Bounded note content, the prompt, recent ready chat messages, vault-root `AGENTS.md`, and directly referenced skill instructions are sent to the selected provider when you submit chat. API keys and settings are stored locally through Obsidian's plugin data mechanism. The vault and note path are sent only when **Include note path** is enabled.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

The plugin is desktop-only because its OpenAI-compatible transport uses browser `fetch` with Server-Sent Events. It does not use Obsidian's `requestUrl` or a provider-specific fallback transport.
