# Privacy and storage

Use this guide when you want to know what Emend can change, what it sends, and what it stores.

Emend makes no background AI requests. Note content leaves the vault only through explicit submissions and the Web flows you opt into for those submissions. Opening chat, changing settings, or selecting Related notes does not send note content.

Web research is **Off** by default. It is available only for DeepSeek `deepseek-flash` and `deepseek-v4-pro`.

## Write permissions

The table describes the note context for each workflow. Every workflow can also include vault-root `AGENTS.md`, directly referenced skills, and explicitly selected Related notes.

Chat, Full-note Edit, and composer Selection can include recent ready messages from the originating chat session. Your history setting controls how many messages are included. Modify Selection sends no chat history.

| Workflow | Context sent | Can write? | Where to review |
| --- | --- | --- | --- |
| Ordinary Chat | Bounded active-note Markdown. | **No.** Chat has no note writer. | Read the Chat response. The note remains unchanged. |
| Chat Selection | The complete note plus the complete captured Selection as read-only focus. | **No.** Chat has no note writer. | Read the Chat response. The note remains unchanged. |
| Full-note Edit | The complete active note. | **Yes.** Emend uses its guarded vault writer after validation and freshness checks. | Review CriticMarkup in the note with Track Changes. |
| composer Selection with Default context (`Edit · Selection`) | The complete captured Selection plus bounded Smart or Symmetric surroundings. | **Yes, only the captured Selection.** Emend uses exact native range replacement. | Review CriticMarkup with Track Changes, or use native undo. |
| Selection with Full-note context (`Edit · Selection · Full note`) | The complete note plus a separate, complete Selection target. | **Yes, only the captured Selection can change.** Full-note context never expands the write target. | Review CriticMarkup with Track Changes, or use native undo. |
| Modify Selection | The complete captured Selection with Default bounded context or Full-note context. No chat history is sent. | **Yes, only the captured Selection can change.** Full-note context never expands the write target. Emend uses exact native range replacement. | Review CriticMarkup with Track Changes, or use native undo. The modal shows result notices. |

Native range replacement preserves Obsidian's native undo for Selection edits. Full-note Edit instead checks the saved note and every open editor for that note before one guarded vault write.

Emend writes validated edits as CriticMarkup, a markup format for reviewing proposed changes. The separate **Track Changes** community plugin visualizes that markup and supplies Accept/Reject controls. Chat does not require Track Changes. Emend does not bundle Track Changes or install it automatically. See the [installation requirements](../../INSTALLATION.md#requirements).

## What leaves the vault

Your selected provider receives every ordinary Chat or Edit submission. The request contains your instruction and the context described in [Write permissions](#write-permissions). The configured API key authenticates the request.

| Round or service | Recipient | Data shared | When it runs |
| --- | --- | --- | --- |
| Ordinary provider submission | Your selected DeepSeek, Kimi, or custom provider endpoint. | Your instruction, workflow context, permitted history, instructions and skills, and bounded Related-note snapshots. | Every explicit Chat or Edit submission. |
| One Edit correction | The same provider and model. | The original request, the invalid candidate, and bounded validation feedback. | At most once after candidate validation fails. Provider, stale-note, and write failures do not trigger it. |
| DeepSeek Search/Fetch | DeepSeek's retrieval endpoints. | Only the validated search query or fetch URL, plus authentication. | Only during an opted-in Web flow for a supported DeepSeek model. |
| Extractor | The same DeepSeek provider and model. | The current typed question, extraction goal, retrieval target, source catalog, and bounded local inspection results. | Once for each readable Search or Fetch result. It has empty chat history and receives no note, instruction, or Related-note context. |
| Verifier and refine rounds | The same DeepSeek provider and model. | The question, goal, claims, and exact quotes. Refine also receives the retrieval target and verifier reasons. | After extraction, to check or revise claims. These rounds have empty history and receive no note or chat context. |

The main answering model receives verified claims with quotes, or quotes-only evidence. It does not receive raw retrieved pages from the extraction loop. Retrieved text is untrusted data, not instructions.

### Note paths and Related notes

**Include note path** is off by default. When it is off, provider prompts omit vault-qualified note paths. Related notes use generic numbered labels without their basenames or paths.

When it is on, Emend sends the vault name and note path for the active note and each selected Related note. Review this setting before submitting sensitive paths.

Related notes are explicit, read-only context. Opening the explorer, choosing notes, and refreshing the selection do not read their bodies or make provider requests. A submission reads bounded snapshots and sends them to the selected provider. Related notes never become edit targets.

### Web sharing and charges

The main DeepSeek model may derive search queries, fetch URLs, and extraction goals from your note and chat context. **Web Review** shows these proposals for editing before retrieval. **Web Auto** skips only that review pause.

Successful retrieval may be billed separately. Extractor, verifier, and refine model rounds may also incur separate charges. Emend does not know your provider's prices and does not estimate charges.

Web research remains read-only. Unsupported providers or models fail with an explicit error instead of silently continuing without Web research. See [Stage 40](../../devel_docs/40-web-content-budget-diagnostics.md) for the exact extraction, evidence, and output-cap rules.

## Local data

| Data | Location | What is kept | Lifetime and reload behavior |
| --- | --- | --- | --- |
| Provider API keys | Obsidian SecretStorage under `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom`. | The provider credentials. Plugin `data.json` always stores empty `apiKey` fields. | SecretStorage values survive reload and plugin-folder removal. An in-memory fallback, used when no stored secret is available, does not survive reload. |
| Emend settings | `<Vault>/.obsidian/plugins/emend/data.json`. | Non-secret provider configuration, privacy choices, history limits, capacity values, and other settings. | Settings survive reload. Removing the Emend plugin folder removes this file. |
| Saved chats | Schema-3 files under `<Vault>/.obsidian/emend/chats/`. | Ready messages with source note paths, concise Edit results, main reasoning, usage, and sanitized Web citations and activity. | Saved sessions and their order survive reload. Drafts and unfinished responses are excluded. |
| Drafts and unfinished responses | Memory only. | Composer drafts, loading or stopped responses, errors, and provisional Web draft text. | Drafts survive note and session switches in the same view lifetime. Everything in this row clears on reload and is not written to saved chats. |
| Additional-note selections and snapshots | Memory only. | Selected paths, helper choices, and submission-time note snapshots. | Selections survive note switches for the same target. Snapshots are request-only. Selections clear on reload, and neither is persisted. |
| Raw retrieval and reader artifacts | Temporary request memory only. | Retrieved content, tool arguments and results, extracted evidence, reader reasoning, and transient failure details. | These artifacts are discarded after the request. They are never written to saved chats. |
| Buffered edit responses | Temporary request memory only. | Raw JSON candidates, compiled responses, and correction feedback. | These artifacts are discarded after validation or failure. Only the concise Edit result can persist. |

Malformed conversation data is preserved. Before the first valid replacement, Emend writes the original bytes to a `.corrupt` backup if that backup does not already exist. Unsupported schema versions are not overwritten. [Stage 43](../../devel_docs/43-multiple-chat-sessions.md) records the exact storage and migration rules.

Deleting a note does not delete its saved chat aggregate. Disabling Emend also preserves its settings and chats. To remove everything, clear each provider's API key in Emend settings, remove the plugin folder, and delete `<Vault>/.obsidian/emend/` separately. The [removal steps](../../INSTALLATION.md#remove-emend) explain this cleanup.

[Stage 51](../../devel_docs/51-2-10-stabilization.md) records the current edit freshness checks, composed-note validation, and storage-resilience fixes.

## Recap

- **What can write:** Only Full-note Edit and Selection Edit can write. Full-note Edit uses the guarded vault writer. Selection uses exact native replacement, and only the captured Selection can change. Chat never writes.
- **What is sent:** Explicit submissions send the listed context to your selected provider. Opted-in DeepSeek Web flows can also send note-derived queries, URLs, and extraction goals, plus claims and quotes from retrieved evidence.
- **What persists:** SecretStorage keys, non-secret settings, and ready chats persist. Drafts, Related-note selections, raw retrieval, reader artifacts, and buffered edit responses do not.
- **What never happens automatically:** Emend makes no background AI requests and never installs other plugins. Chat never edits a note, and Full-note Selection context never expands the Selection write target.
