# Emend

## Project overview

This repository contains an Obsidian community plugin written in TypeScript and bundled with esbuild. The plugin provides context-aware, streamed AI chat for Markdown notes in explicit modes, guarded full-note editing in Edit mode, and guarded selected-text replacement. Closed JSON operations are the only model-facing edit protocol; valid operations compile into the same internal CriticMarkup and Track Changes path.

The repository contains the completed Emend rewrite:

- The **current implementation and release identity are Emend**. `manifest.json` uses plugin ID `emend` and name `Emend`; `package.json`, `manifest.json`, `package-lock.json`, and `versions.json` carry consistent release metadata. This is a clean plugin ID with no Lapis Lazuli data migration.
- Ask, Discuss, and Brainstorm modes, instruction/skill loading, and streamed chat are wired into the current runtime. These paths have no note writer.
- Edit mode sends the complete captured note and privately buffers the response. The Operations-only strategy atomically validates/compiles closed JSON operations, then Stage 07 revalidates the resulting markup before stale source/target guards and one `vault.modify` write. Track Changes is the only review surface.
- Modify Selection captures exact offsets before opening its instruction modal, sends the complete selection with default smart structural context or an exact Stage 09 symmetric opt-out, validates only the compiled annotated selection, and replaces only the captured range through `editor.replaceRange` for native undo. Operation targets cannot address text outside that selection. The modal also reuses the three shared quick actions through the same submission path.
- The dormant diff module, editor extension, callbacks, styles, and CodeMirror dependencies are removed.

The manifest requires Obsidian `1.11.4` or newer and sets `isDesktopOnly` to `true`. The streaming provider transport uses desktop browser `fetch` and Server-Sent Events; mobile support is not currently declared.

## Technology stack and build process

- TypeScript with strict compiler checks; source files are under `src/`.
- Obsidian API for plugin lifecycle, workspace views, Markdown rendering, settings, vault access, and notices; browser `fetch` and Server-Sent Events for provider streaming.
- esbuild bundles `src/main.ts` into a CommonJS `main.js` at the repository root, targeting ES2021.
- Obsidian, Electron, CodeMirror/Lezer modules, and Node built-ins are external to the bundle and supplied by the host. Other runtime code must be bundled; do not add unbundled runtime dependencies.
- Development builds include inline source maps and are unminified. Production builds are minified and have no source map.

### Commands

Use npm from the repository root:

```bash
npm install
npm run dev
npm run build
npm run lint
npm test
```

- `npm install` installs the dependencies in `package.json`. Use `npm ci` with the committed `package-lock.json` for reproducible installs and CI.
- `npm run dev` starts esbuild in watch mode and writes `main.js`. It does **not** run TypeScript type checking; use the production build or `npx tsc -noEmit -skipLibCheck` for that check.
- `npm run build` runs `tsc -noEmit -skipLibCheck` and then creates the production `main.js`.
- `npm run lint` runs ESLint over the project using the typed `typescript-eslint` setup and `eslint-plugin-obsidianmd` recommended rules.
- `npm test` runs Vitest once; `npm run test:watch` starts watch mode. Tests use the `obsidian` mock alias and must not access a real vault or the network.

`main.js`, source maps, `node_modules/`, `test_vault/`, and Obsidian's local `data.json` are gitignored. Do not commit generated bundles, vault content, mock credentials, or local plugin settings.

## Source organization and responsibilities

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle and orchestration: settings, conversation-store construction, chat/mode/selection-command registration, target-view tracking, note-switch loading, context capture, shared per-note pending isolation, and mode-specific coordinator/writer construction. |
| `src/chat-view.ts` | Right-sidebar `ItemView`, per-session mode, generation-guarded per-note chat state, streamed Markdown/reasoning rendering, edit summaries, draft-preserving composer and mode controls, Stop, copy action, ready-message persistence, and submission flow. |
| `src/chat-shortcuts.ts` | Pure composer and mode shortcut matching for Enter, platform Mod, Shift, and modifier-conflict guards. |
| `src/conversation-store.ts` | Versioned per-note thread schema, SHA-256 storage paths, DataAdapter persistence, atomic writes, corruption backup, unsupported-version protection, and per-note write serialization. |
| `src/context.ts` | Synchronous note snapshots and bounded caret/selection-centered Markdown windows with exact omission markers. |
| `src/request-coordinator.ts` | Writer-free Ask/Discuss/Brainstorm submission and the separate Edit coordinator with full-source prompting, private buffering, reasoning forwarding, validation, application, and chat usage resolution. |
| `src/note-writer.ts` | The only full-note AI application path: no-op handling, current-source and active-target stale checks, final permission check, and the `vault.read`/`vault.modify` adapter. |
| `src/selection-context.ts` | Exact selection targets with deterministic containing/adjacent paragraph, YAML-frontmatter, and fenced-code context expansion, source-character budgets, and omission markers. |
| `src/selection-editor.ts` | Exact selection snapshots, untruncated selection plus smart or Stage 09 symmetric prompting, selection coordination, stale/target/abort guards, and the native editor-range adapter. |
| `src/selection-modal.ts` | Explicit selection-instruction and shared quick-action submission, pending controls, cancellation/abort, and result/error notices without rendering annotated output as chat. |
| `src/critic-markup.ts` / `src/edit-strategy.ts` | Internal CriticMarkup parsing, reject-view and sequential-markup validation, edit preparation, and the Operations-only strategy boundary/factory. |
| `src/operation-edit-strategy.ts` | Closed JSON operation parsing, exact original-snapshot occurrence resolution, atomic ambiguity/overlap validation, deterministic CriticMarkup compilation, and operation-specific full/selection prompts. |
| `src/provider-stream.ts` | OpenAI-compatible streaming `fetch` transport, SSE parsing, content/reasoning/usage events, and provider error handling. |
| `src/token-usage.ts` | Provider-versus-estimated usage resolution, character-based fallback estimates, source labels, and footer formatting. |
| `src/instructions-loader.ts` | Vault-root `AGENTS.md` loading and safe, directly referenced skill discovery. |
| `src/mode.ts` / `src/permissions.ts` | Mode catalog, mode-specific system prompts, and deterministic note-write permission contracts. |
| `src/quick-actions.ts` | Stable quick-action IDs, labels, deterministic Edit prompts, and shared availability rules. |
| `src/settings.ts` | Provider catalog, defaults, persisted-data normalization, and the settings tab. |
| `src/types.ts` | Shared provider, mode, message, reasoning-effort, instruction, selection snapshot, and persisted settings types. |
| `styles.css` | Streamed chat styles using the `emend-` prefix and Obsidian CSS variables. |
| `esbuild.config.mjs` | Development/watch and production bundle configuration. |
| `eslint.config.mts` | ESLint flat configuration and typed linting. |
| `manifest.json` / `versions.json` | Obsidian release metadata and plugin-version-to-minimum-app-version mapping. |
| `version-bump.mjs` | npm version hook that synchronizes release metadata. |
| `IMPLEMENTATION_PLAN.md` | Implemented-status architecture contract and index to the numbered stage records; current behavior and release evidence are linked from it. |

Keep new feature logic in focused modules rather than adding unrelated responsibilities to an already large module. Preserve the separation between context capture, request coordination, provider transport, note writing, UI, and plugin orchestration.

## Current runtime architecture

### Target note and request context

`main.ts` targets the active Markdown view when available. If focus is in the chat sidebar, it uses the last active still-open Markdown view, then falls back to another open Markdown view. `captureChatContext()` synchronously captures the target `TFile`, full source text, selection offsets, note label, optional vault-qualified path, and bounded Markdown before instruction reads or networking.

Read-only requests include bounded Markdown context. Notes within the configured character limit are sent whole; longer notes are windowed around the selection or caret, with `[...]` markers at omitted edges and unused budget redistributed toward available text. The default limit is 12,000 characters and the settings UI enforces a minimum of 1,000. Full-note Edit ignores the bounded `markdown` window and always sends `sourceText`. Modify Selection always sends the complete selection. Smart selection context defaults on and expands to containing paragraph(s), complete document-leading YAML, and complete fenced code before adding whole adjacent blocks within the source-character budget; oversized containing blocks use symmetric marked truncation without changing the target. Disabling it restores Stage 09 symmetric before/after context, including empty surroundings for an oversized selection. Vault name and note path are opt-in and disabled by default.

### Sequential edits and per-note request isolation

`main.ts` owns one pending-path registry shared by every chat mode and Modify Selection. After synchronous target capture and nonempty prompt validation, `withNoteRequest()` acquires the captured note path before instruction reads or networking. A second request for that path rejects with exactly `Wait for the current Emend request to finish.`; different note paths can proceed independently. The single chat view also disables its own duplicate UI submissions while sending.

The submission captures mode and source before awaiting. Each sequential Edit therefore uses the latest complete annotated note as its source, preserves earlier Track Changes tokens, and sends only ready user prompts plus concise applied-edit summaries as assistant history. Full annotated responses remain private and are never persisted.

The pending path is deleted in `finally` only after the coordinator settles on success, provider error, validation error, stale failure, or abort. Stop, chat close/note-switch aborts, and selection cancel/close therefore permit a retry without weakening the existing post-await abort, exact-source, active-target, or permission checks. A pending old-note request remains keyed to its captured path and cannot apply to a newly active note.

### Streamed chat and guarded editing

1. `chat-view.ts` initializes one mode from `defaultMode` per view session. Switching notes does not reset the selected mode. Ask, Edit, Discuss, and Brainstorm use their Stage 03 icons, badges, and placeholders. Enter and Mod+Enter submit through the normal path, with Mod+Enter registered on the view's Obsidian `Scope` and restricted to the live composer so the window keymap cannot swallow it. Shift+Enter remains a newline, and disabled/loading controls reject shortcut submission. The `emend:switch-to-ask-mode` and `emend:switch-to-edit-mode` commands use default Mod+Shift+A/E hotkeys, open/focus chat, preserve the composer draft, and only change the next-request mode; they never submit, request, write, or abort a pending submission.
2. Submission captures context and up to the last eight ready chat messages. Duplicate submissions are disabled while a request or thread load is active. The Fix grammar, Make concise, and Add examples buttons above the composer select Edit and call this same submission path exactly once with their mapped prompts; they are disabled without a note thread and during loading or sending. They have no separate provider, history, persistence, pending, or writer path.
3. `ReadOnlyRequestCoordinator` loads current vault instructions on every request, builds the selected read-only prompt with skills before agent instructions, and calls `requestAiResponse`. Its dependencies and submission contract contain no note writer. Completed results resolve valid provider usage or a clearly sourced estimate from the exact request and response text.
4. Only `EditRequestCoordinator` receives a writer. It uses the Operations-only full-note prompt, forwards reasoning while privately buffering content until provider completion, and rejects aborts. Operations require a bare closed-union JSON array, exact original anchors/targets, occurrence disambiguation, and nonoverlapping/unambiguous ranges before compiling. Stage 07 `prepareCriticMarkupEdit` revalidates the compiled markup before `applyPreparedEdit` and returns resolved usage with the concise result. `getEditStrategy()` takes no settings and always returns this operation strategy.
5. `applyPreparedEdit` returns without reading or writing for read-only modes and unchanged responses. For a changed Edit response it re-reads the captured file, immediately rechecks the request abort signal, requires both exact source equality and the same active target, checks `canWriteToNote(mode)` immediately before writing, and calls `vault.modify` exactly once. The stale error is `The note changed while Emend was responding. No edits were applied.`
6. Read-only content streams as Markdown through Obsidian `MarkdownRenderer` with the captured file path as source path; streaming renders are throttled to one animation frame and pending frames are cancelled on close. Reasoning is plain text in a closed `details` element. Model output is never assigned with `innerHTML`.
7. Edit responses are never rendered into chat. Success stores only `Edit applied — N changes tracked. Review in Track Changes.` as assistant history; unchanged responses store `No changes were needed.` Valid comment-only edits may apply with zero text changes. Ready assistant footers show total/prompt/completion usage and its provider/estimated source, including Edit summaries; loading, stopped, error, and user messages have no usage footer.
8. Stop aborts the active request. Success, provider errors, validation errors, stale errors, and aborts all clear loading state. Stopped partial responses and errors are excluded from later ready-message history and local persistence.

### Conversation persistence

1. `ConversationStore` uses schema version 1 and stores threads under `<configDir>/emend/chats/`. Each filename combines a short sanitized basename with the full SHA-256 hash of the exact note path, remains bounded, and never embeds raw `../` path components. Hashing uses browser `crypto.subtle`; persistence uses Obsidian's vault `DataAdapter`, not Node APIs.
2. Only ready user/assistant messages are serialized, including mode, reasoning, source path, timestamp, and optional token usage with its provider/estimated source. Legacy source-less usage loads as provider-reported. Loading, stopped, and error messages, API keys, note snapshots, request bodies, and buffered full edit responses are not persisted. Edit entries contain only concise result summaries and usage.
3. Saves stage a temp file and rename it into place. If the host refuses rename-over-existing, the store uses Obsidian's atomic `DataAdapter.process` replacement and removes the temp file. Writes are serialized per note and snapshot messages at invocation. Loads wait for already-queued writes to that note.
4. Malformed loads leave the original untouched and issue a non-secret warning. The next save writes the malformed bytes to one reusable `.corrupt` backup before atomically replacing the thread. Any unsupported schema version is left untouched and rejects saves instead of being silently overwritten.
5. The chat loads the captured target note and saves after the ready user and completed assistant transitions. `main.ts` routes both `active-leaf-change` and `file-open` through one shared refresh callback, covering same-leaf file navigation without separate racing flows. Generation checks prevent stale async loads from replacing a newly selected note's messages, and repeated same-note events return without a new load. Switching notes aborts the active request and does not reset the per-view mode. Deleting a note does not delete its thread.

### Guarded selection editing

1. The `emend:modify-selected-text` editor command is available only for a nonempty Markdown selection. It synchronously captures `SelectionSnapshot { file, fullText, selectedText, from, to }` and the source-view adapter before opening the instruction modal. The serializable snapshot contains no editor or view.
2. Opening the modal makes no request. An explicit nonempty instruction or one of the shared Fix grammar, Make concise, and Add examples actions loads current instructions/skills, uses the Operations-only selection prompt and Stage 05 streaming transport with no chat history, and privately buffers the response rather than rendering it as a chat answer. Every action calls the same `submit(prompt)` path exactly once, requires no typed input, disables the input and action buttons while pending, and re-enables them on settlement when the modal remains open.
3. `buildSmartSelectionContext()` returns exact unchanged `from`/`to` and complete `selectedText` plus smart `contextText`. It includes containing blocks first, then whole adjacent blocks before-side first and after-side second while they fit. Exact `[...]` markers decorate omitted edges and are additional to the source-character budget. The opt-out uses the unchanged Stage 09 before/after builder and prompt fields. Neither path expands the edit target.
4. Operations compile against exactly the captured selection, then Stage 07 revalidates the compiled CriticMarkup selection. Anchors and targets outside that selection fail before any read or replacement. The response is merged into captured full text for no-op handling; unchanged responses do not read or replace.
5. Before replacement, the current editor value must equal captured full text, the captured view must still reference the captured file and be the current target, and the signal and `canWriteToNote('edit')` checks must pass. One `editor.replaceRange` at captured offsets performs the only write, preserving native Obsidian undo. Selection edits never call `vault.modify`; stale source/target uses the same stale error as full-note editing.
6. Cancel/Stop and modal close abort pending requests. Provider, validation, abort, and stale failures replace nothing and release the pending controls for retry. Track Changes remains the only review UI.

The legacy JSON answer/edit protocol, accumulating adapters, inline suggestion command/extension/module, inline styles, dormant diff UI, and in-plugin Apply/Reject flow are removed. Track Changes provides the only CriticMarkup review UI.

### Providers and settings

DeepSeek, Kimi, and custom providers all use one OpenAI-compatible streaming chat-completion transport in `provider-stream.ts`. Each provider has an editable HTTP(S) base URL, API key, model, reasoning-effort setting, and `requestUsage` compatibility toggle. The toggle defaults on for DeepSeek/Kimi and off for custom. Requests use browser `fetch` with `stream: true`, `temperature: 0.3`, the configured `reasoning_effort`, and at most the last eight history messages. Base URLs are trimmed of trailing slashes before `/chat/completions` is appended. `stream_options: { include_usage: true }` is present only when `requestUsage` is true; provider rejection remains an error with no automatic retry, so users can disable the option. Content and reasoning deltas are emitted separately, with optional final token usage and a done event. Usage parsing requires a complete nonnegative integer triplet and preserves zero. Provider errors include HTTP status and available provider details without credentials. There is no `requestUrl`, Gemini/Claude transport, provider-specific HTTP implementation, fallback, or retry.

When valid provider usage is absent, chat coordinators estimate request and response tokens independently as `max(1, ceil(characters / 4))`, using system prompt, retained history, current user prompt, response content, and reasoning. Estimated total is prompt plus completion and is always labeled `Estimated`; it is not provider billing data. No pricing, tokenizer, or model-metadata network calls are added.

Settings are loaded with `loadData()`, normalized against defaults, and saved with `saveData()`. Per-provider configuration including `requestUsage`, active provider, default mode, note-path inclusion, smart selection context, and context size are stored locally in Obsidian plugin data. There is no edit-strategy setting or selector; legacy `editStrategy` values are dropped during normalization because Operations is always used. `smartSelectionContext` defaults to `true`; missing or malformed values normalize to that default, while explicit `false` restores Stage 09 behavior. Ready chat threads use the separate versioned conversation store; stopped/error states are not persisted.

## Coding conventions

- Follow the existing TypeScript style: tabs for indentation, single quotes, semicolons, trailing commas where used, and `async`/`await` for asynchronous work.
- Keep strictness intact. `tsconfig.json` enables `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `isolatedModules`, and consistent file-name casing. Handle possibly missing indexed values rather than suppressing these checks.
- Use Obsidian DOM helpers and `MarkdownRenderer`; keep user-facing copy short and in sentence case. Use the correct window's animation-frame APIs for popout compatibility and never inject model output with `innerHTML`.
- Register views, editor extensions, workspace events, commands, and other disposable resources through Obsidian's registration helpers so unload/reload cleans them up. Abort active chat and selection requests and cancel pending renders when their views close.
- Use the streaming `fetch` transport in `provider-stream.ts` for provider networking. Do not reintroduce `requestUrl`, a second HTTP stack, provider-specific transports, or silent retries. Preserve response validation and useful credential-safe error propagation.
- Use Obsidian CSS variables and the `emend-` CSS prefix for current UI. Update CSS classes and selectors together.
- Current public identifiers are plugin ID `emend`, view type `emend-chat-view`, chat command ID `emend:open-chat`, mode command IDs `emend:switch-to-ask-mode` / `emend:switch-to-edit-mode`, and selection command ID `emend:modify-selected-text`. Keep renames consistent and deliberate.
- Keep startup work limited and avoid unnecessary vault scans or background AI requests. Desktop-only APIs are permitted by the manifest, but current provider streaming needs only standard browser APIs.

## Testing instructions

Unit tests use Vitest and live under `tests/`, with Obsidian mocked by `tests/mocks/obsidian.ts`. At minimum, run all local gates after code changes:

```bash
npm test
npm run build
npm run lint
git diff --check
```

These checks do not exercise Obsidian, CodeMirror interaction, or real provider APIs. Perform manual testing by copying `main.js`, `manifest.json`, and `styles.css` to:

```text
<Vault>/.obsidian/plugins/emend/
```

Use only the ignored `test_vault/` and a local OpenAI-compatible SSE mock with CORS and dummy credentials. Never use real accounts/keys or modify other vaults. Relevant scenarios include:

- Stream Ask, Discuss, and Brainstorm responses and verify that only chat changes; the note remains byte-for-byte unchanged.
- Apply insertion, deletion, substitution, and comment Operations in Edit mode; inspect actual resulting Markdown and Track Changes review behavior, including repeated-anchor occurrence handling and preserved existing markup. Reject malformed commands, ambiguous anchors, overlapping ranges, nested markup delimiters, and out-of-selection targets without writes. Verify legacy `editStrategy` data is dropped and no selector is rendered.
- Apply single-line and multiline Modify Selection edits; inspect complete untruncated selections, bounded surrounding context, native undo, and Track Changes markup. Click all three selection quick actions to verify exact single submission, pending disable/settlement behavior, and no writes on failures.
- Verify a phrase in a long paragraph sends full-paragraph smart context while only the phrase is replaced; toggle **Smart selection context** off to confirm exact Stage 09 symmetric context. Exercise YAML frontmatter and fenced code, including internal blank lines and over-budget blocks, and compare actual request payloads and resulting Markdown without any target expansion.
- Reject invalid output, stale source edits, and target-note switches without writes. Stop streams and trigger provider errors without partial writes or duplicate submissions.
- Verify unchanged responses do not write, valid comment-only edits may write with zero text changes, three sequential edits use each prior annotated source and preserve old markup, and second/third request history stores only concise summaries rather than annotated documents.
- Verify full-note chat and Modify Selection share the same pending-path rejection, different notes remain independent, target switches cannot write, and Stop/provider/validation/stale failures all permit a successful retry.
- Verify separate two-note threads, restoration after an actual Obsidian reload, rapid-note-switch load guards, atomic replacement, malformed-file preservation and `.corrupt` backup, unsupported-version refusal, and sanitized stored data without credentials, request bodies, snapshots, loading/error messages, or full edit payloads. Deleting a note leaves its thread in place.
- Inspect mock requests for complete uncapped source in Edit, complete selections even above the context budget, bounded read-only and selection-surrounding context, smart containing/adjacent blocks with exact omission markers, eight-message chat history, current instruction/skill ordering, and note-path omission/inclusion according to the privacy setting.
- Verify provider-reported and estimated usage footers on completed chat and Edit summaries, usage/source persistence after reload, absent footers for transient/error states, `stream_options` only while **Request token usage** is enabled, and no retry when a provider rejects the option. Use only a local mock and never make paid verification calls.
- Verify Markdown, links, math, folded reasoning, copy, mode badges/placeholders, model label, per-session mode retention, and close/unload cleanup.
- Verify Enter and Cmd/Ctrl+Enter send, Shift+Enter inserts a newline, Cmd/Ctrl+Shift+A/E and their Command Palette entries preserve drafts and switch only the next-request mode without requests or writes, and disabled/pending composers cannot shortcut-submit. Exercise the platform UI mapping available for manual testing and record any unexercised Ctrl platform honestly.
- Exercise desktop streaming behavior when changing provider transport or APIs. Mobile support is not declared while `isDesktopOnly` is `true`.

Selection editing must preserve native `editor.replaceRange` undo and must not revive legacy JSON, inline, `vault.modify`, or in-plugin diff flows.

## Security and privacy

- API keys are secrets stored in Obsidian's local plugin data. Never commit `data.json`, print keys, or include them in logs and error messages. Manual mock credentials must remain dummy values in ignored vault data.
- Read-only requests send bounded note content. Full-note Edit sends the complete note regardless of the context limit. Modify Selection sends the complete selection plus surrounding context, never a truncated selection. Default smart context can send complete containing/adjacent paragraphs, YAML frontmatter, or fenced code within the source-character budget; exact omission markers are additional. The opt-out sends Stage 09 symmetric before/after context. Prompts, recent ready chat history for chat requests, vault-root `AGENTS.md`, and directly referenced skills are sent to the selected provider when the user submits. There are no background AI requests; local thread saves perform no networking.
- Ready chats remain local under `<configDir>/emend/chats/`. Completed usage counts and their provider/estimated source may persist with ready assistant messages. Do not persist credentials, request bodies, note snapshots, loading/error/stopped messages, or full edit responses. Deleting a note does not automatically delete its thread. Preserve malformed data and never overwrite unsupported schema versions. Estimates are character-based, not provider billing data; do not add pricing or model-metadata calls.
- The vault/note path is sent only when **Include note path** is enabled.
- Ask/Discuss/Brainstorm have no note writer. Only the full-note Edit coordinator receives the guarded vault writer; selection coordination receives only the guarded native editor adapter. Both write validated CriticMarkup immediately after completion and stale checks. Do not add writes outside these permission-gated paths or revive automatic legacy JSON edits.
- Do not add telemetry, remote code execution, automatic plugin downloads, or unrelated network calls. Keep current file access within the vault and limited to the active note, its local conversation thread, and declared instructions/skills.
- Preserve clear provider error handling without exposing request headers or credentials.

## Versioning and deployment

Use semantic versioning. Running:

```bash
npm version <patch|minor|major>
```

updates `package.json` through npm and invokes the `version` script, which copies `npm_package_version` into `manifest.json`, adds the version and current `minAppVersion` to `versions.json` if absent, and stages those two metadata files. Review the resulting changes rather than editing the files inconsistently.

For a release, run a production build and publish `main.js`, `manifest.json`, and `styles.css` as individual assets on the repository's Gitea host (matching `origin`). The Gitea release tag should exactly match the manifest version, without a leading `v`. Keep `minAppVersion` and the `versions.json` mapping accurate when adopting newer Obsidian APIs.

Gitea Actions runs lint, tests, and the production build through `.gitea/workflows/ci.yaml`. The unique `emend-macos` label targets the repository's `emend-macos-docker` runner; verify that runner is online before treating a pushed check as actionable. Releases remain manual.
