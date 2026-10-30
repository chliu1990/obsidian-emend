# Emend

## Project overview

This repository contains an Obsidian community plugin written in TypeScript and bundled with esbuild. The plugin provides context-aware, streamed AI chat for Markdown notes in explicit modes, guarded full-note CriticMarkup editing in Edit mode, and guarded selected-text replacement.

The repository is in an architecture transition:

- The **current implementation and release identity are Emend**. `manifest.json` uses plugin ID `emend`, name `Emend`, and version `1.0.2`; `package.json` is named `emend` at the same version. This is a clean plugin ID with no Lapis Lazuli data migration.
- Ask, Discuss, and Brainstorm modes, instruction/skill loading, and streamed chat are wired into the current runtime. These paths have no note writer.
- Edit mode sends the complete captured note, buffers and validates the CriticMarkup response, guards against stale source or target changes, and writes once through `vault.modify`. Track Changes is the only review surface.
- Modify Selection captures exact offsets before opening its instruction modal, sends the complete selection with bounded surrounding context, validates the complete annotated selection, and replaces only that range through `editor.replaceRange` for native undo.
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
| `src/main.ts` | Plugin lifecycle and orchestration: settings, conversation-store construction, chat and selection-command registration, target-view tracking, note-switch loading, context capture, and mode-specific coordinator/writer construction. |
| `src/chat-view.ts` | Right-sidebar `ItemView`, per-session mode, generation-guarded per-note chat state, streamed Markdown/reasoning rendering, edit summaries, composer, Stop, copy action, ready-message persistence, and submission flow. |
| `src/conversation-store.ts` | Versioned per-note thread schema, SHA-256 storage paths, DataAdapter persistence, atomic writes, corruption backup, unsupported-version protection, and per-note write serialization. |
| `src/context.ts` | Synchronous note snapshots and bounded caret/selection-centered Markdown windows with exact omission markers. |
| `src/request-coordinator.ts` | Writer-free Ask/Discuss/Brainstorm submission and the separate Edit coordinator with full-source prompting, private buffering, reasoning forwarding, validation, and application. |
| `src/note-writer.ts` | The only full-note AI application path: no-op handling, current-source and active-target stale checks, final permission check, and the `vault.read`/`vault.modify` adapter. |
| `src/selection-editor.ts` | Exact selection snapshots, untruncated selection plus bounded before/after prompting, selection coordination, stale/target/abort guards, and the native editor-range adapter. |
| `src/selection-modal.ts` | Explicit selection-instruction submission, cancellation/abort, and result/error notices without rendering annotated output as chat. |
| `src/critic-markup.ts` / `src/edit-strategy.ts` | CriticMarkup parsing, reject-view and sequential-markup validation, edit preparation, and the editing-strategy boundary. |
| `src/provider-stream.ts` | OpenAI-compatible streaming `fetch` transport, SSE parsing, content/reasoning/usage events, and provider error handling. |
| `src/instructions-loader.ts` | Vault-root `AGENTS.md` loading and safe, directly referenced skill discovery. |
| `src/mode.ts` / `src/permissions.ts` | Mode catalog, mode-specific system prompts, and deterministic note-write permission contracts. |
| `src/settings.ts` | Provider catalog, defaults, persisted-data normalization, and the settings tab. |
| `src/types.ts` | Shared provider, mode, message, reasoning-effort, instruction, selection snapshot, and persisted settings types. |
| `styles.css` | Streamed chat styles using the `emend-` prefix and Obsidian CSS variables. |
| `esbuild.config.mjs` | Development/watch and production bundle configuration. |
| `eslint.config.mts` | ESLint flat configuration and typed linting. |
| `manifest.json` / `versions.json` | Obsidian release metadata and plugin-version-to-minimum-app-version mapping. |
| `version-bump.mjs` | npm version hook that synchronizes release metadata. |
| `IMPLEMENTATION_PLAN.md` | Proposed Emend rewrite, not a complete description of current behavior. |

Keep new feature logic in focused modules rather than adding unrelated responsibilities to an already large module. Preserve the separation between context capture, request coordination, provider transport, note writing, UI, and plugin orchestration.

## Current runtime architecture

### Target note and request context

`main.ts` targets the active Markdown view when available. If focus is in the chat sidebar, it uses the last active still-open Markdown view, then falls back to another open Markdown view. `captureChatContext()` synchronously captures the target `TFile`, full source text, selection offsets, note label, optional vault-qualified path, and bounded Markdown before instruction reads or networking.

Read-only requests include bounded Markdown context. Notes within the configured character limit are sent whole; longer notes are windowed around the selection or caret, with `[...]` markers at omitted edges and unused budget redistributed toward available text. The default limit is 12,000 characters and the settings UI enforces a minimum of 1,000. Full-note Edit ignores the bounded `markdown` window and always sends `sourceText`. Modify Selection sends the complete selection plus bounded before/after context within the same limit; an oversized selection is sent whole with no surrounding context. Vault name and note path are opt-in and disabled by default.

### Streamed chat and guarded editing

1. `chat-view.ts` initializes one mode from `defaultMode` per view session. Switching notes does not reset the selected mode. Ask, Edit, Discuss, and Brainstorm use their Stage 03 icons, badges, and placeholders.
2. Submission captures context and up to the last eight ready chat messages. Duplicate submissions are disabled while a request or thread load is active.
3. `ReadOnlyRequestCoordinator` loads current vault instructions on every request, builds the selected read-only prompt with skills before agent instructions, and calls `requestAiResponse`. Its dependencies and submission contract contain no note writer.
4. Only `EditRequestCoordinator` receives a writer. It uses the full-note CriticMarkup prompt, forwards reasoning while privately buffering content until provider completion, rejects aborts, validates against captured source through Stage 07, and delegates to `applyPreparedEdit`.
5. `applyPreparedEdit` returns without reading or writing for read-only modes and unchanged responses. For a changed Edit response it re-reads the captured file, immediately rechecks the request abort signal, requires both exact source equality and the same active target, checks `canWriteToNote(mode)` immediately before writing, and calls `vault.modify` exactly once. The stale error is `The note changed while Emend was responding. No edits were applied.`
6. Read-only content streams as Markdown through Obsidian `MarkdownRenderer` with the captured file path as source path; streaming renders are throttled to one animation frame and pending frames are cancelled on close. Reasoning is plain text in a closed `details` element. Model output is never assigned with `innerHTML`.
7. Edit responses are never rendered into chat. Success stores only `Edit applied — N changes tracked. Review in Track Changes.` as assistant history; unchanged responses store `No changes were needed.` Valid comment-only edits may apply with zero text changes.
8. Stop aborts the active request. Success, provider errors, validation errors, stale errors, and aborts all clear loading state. Stopped partial responses and errors are excluded from later ready-message history and local persistence.

### Conversation persistence

1. `ConversationStore` uses schema version 1 and stores threads under `<configDir>/emend/chats/`. Each filename combines a short sanitized basename with the full SHA-256 hash of the exact note path, remains bounded, and never embeds raw `../` path components. Hashing uses browser `crypto.subtle`; persistence uses Obsidian's vault `DataAdapter`, not Node APIs.
2. Only ready user/assistant messages are serialized, including mode, reasoning, source path, timestamp, and optional token usage. Loading, stopped, and error messages, API keys, note snapshots, request bodies, and buffered full edit responses are not persisted. Edit entries contain only concise result summaries.
3. Saves stage a temp file and rename it into place. If the host refuses rename-over-existing, the store uses Obsidian's atomic `DataAdapter.process` replacement and removes the temp file. Writes are serialized per note and snapshot messages at invocation. Loads wait for already-queued writes to that note.
4. Malformed loads leave the original untouched and issue a non-secret warning. The next save writes the malformed bytes to one reusable `.corrupt` backup before atomically replacing the thread. Any unsupported schema version is left untouched and rejects saves instead of being silently overwritten.
5. The chat loads the captured target note and saves after the ready user and completed assistant transitions. Generation checks prevent stale async loads from replacing a newly selected note's messages; switching notes aborts the active request and does not reset the per-view mode. Deleting a note does not delete its thread.

### Guarded selection editing

1. The `emend:modify-selected-text` editor command is available only for a nonempty Markdown selection. It synchronously captures `SelectionSnapshot { file, fullText, selectedText, from, to }` and the source-view adapter before opening the instruction modal. The serializable snapshot contains no editor or view.
2. Opening the modal makes no request. An explicit nonempty instruction loads current instructions/skills, uses the Stage 03 selection prompt and Stage 05 streaming transport with no chat history, and privately buffers the annotated selection rather than rendering it as a chat answer.
3. Stage 07 validates the complete response against the captured selection. The response is merged into captured full text for no-op handling; unchanged responses do not read or replace.
4. Before replacement, the current editor value must equal captured full text, the captured view must still reference the captured file and be the current target, and the signal and `canWriteToNote('edit')` checks must pass. One `editor.replaceRange` at captured offsets performs the only write, preserving native Obsidian undo. Selection edits never call `vault.modify`; stale source/target uses the same stale error as full-note editing.
5. Cancel/Stop and modal close abort pending requests. Provider, validation, abort, and stale failures replace nothing. Track Changes remains the only review UI, and smart paragraph expansion remains Stage 15.

The legacy JSON answer/edit protocol, accumulating adapters, inline suggestion command/extension/module, inline styles, dormant diff UI, and in-plugin Apply/Reject flow are removed. Track Changes provides the only CriticMarkup review UI.

### Providers and settings

DeepSeek, Kimi, and custom providers all use one OpenAI-compatible streaming chat-completion transport in `provider-stream.ts`. Each provider has an editable HTTP(S) base URL, API key, model, and reasoning-effort setting. Requests use browser `fetch` with `stream: true`, `temperature: 0.3`, the configured `reasoning_effort`, and at most the last eight history messages. Base URLs are trimmed of trailing slashes before `/chat/completions` is appended. Content and reasoning deltas are emitted separately, with optional final token usage and a done event. Provider errors include HTTP status and available provider details without credentials. There is no `requestUrl`, Gemini/Claude transport, provider-specific HTTP implementation, fallback, or retry. `stream_options` is deferred to Stage 14.

Settings are loaded with `loadData()`, normalized against defaults, and saved with `saveData()`. Per-provider configuration, active provider, default mode, note-path inclusion, and context size are stored locally in Obsidian plugin data. Ready chat threads use the separate versioned conversation store; stopped/error states are not persisted.

## Coding conventions

- Follow the existing TypeScript style: tabs for indentation, single quotes, semicolons, trailing commas where used, and `async`/`await` for asynchronous work.
- Keep strictness intact. `tsconfig.json` enables `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `isolatedModules`, and consistent file-name casing. Handle possibly missing indexed values rather than suppressing these checks.
- Use Obsidian DOM helpers and `MarkdownRenderer`; keep user-facing copy short and in sentence case. Use the correct window's animation-frame APIs for popout compatibility and never inject model output with `innerHTML`.
- Register views, editor extensions, workspace events, commands, and other disposable resources through Obsidian's registration helpers so unload/reload cleans them up. Abort active chat and selection requests and cancel pending renders when their views close.
- Use the streaming `fetch` transport in `provider-stream.ts` for provider networking. Do not reintroduce `requestUrl`, a second HTTP stack, provider-specific transports, or silent retries. Preserve response validation and useful credential-safe error propagation.
- Use Obsidian CSS variables and the `emend-` CSS prefix for current UI. Update CSS classes and selectors together.
- Current public identifiers are plugin ID `emend`, view type `emend-chat-view`, chat command ID `emend:open-chat`, and selection command ID `emend:modify-selected-text`. Keep renames consistent and deliberate.
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
- Apply insertion, deletion, substitution, comment, and highlight edits in Edit mode; inspect actual resulting Markdown and Track Changes review behavior.
- Apply single-line and multiline Modify Selection edits; inspect complete untruncated selections, bounded surrounding context, native undo, and Track Changes markup.
- Reject invalid output, stale source edits, and target-note switches without writes. Stop streams and trigger provider errors without partial writes or duplicate submissions.
- Verify unchanged responses do not write, valid comment-only edits may write with zero text changes, sequential edits preserve old markup, and chat history stores summaries rather than annotated documents.
- Verify separate two-note threads, restoration after an actual Obsidian reload, rapid-note-switch load guards, atomic replacement, malformed-file preservation and `.corrupt` backup, unsupported-version refusal, and sanitized stored data without credentials, request bodies, snapshots, loading/error messages, or full edit payloads. Deleting a note leaves its thread in place.
- Inspect mock requests for complete uncapped source in Edit, complete selections even above the context budget, bounded read-only and selection-surrounding context, eight-message chat history, current instruction/skill ordering, and note-path omission/inclusion according to the privacy setting.
- Verify Markdown, links, math, folded reasoning, copy, mode badges/placeholders, model label, per-session mode retention, and close/unload cleanup.
- Exercise desktop streaming behavior when changing provider transport or APIs. Mobile support is not declared while `isDesktopOnly` is `true`.

Selection editing must preserve native `editor.replaceRange` undo and must not revive legacy JSON, inline, `vault.modify`, or in-plugin diff flows.

## Security and privacy

- API keys are secrets stored in Obsidian's local plugin data. Never commit `data.json`, print keys, or include them in logs and error messages. Manual mock credentials must remain dummy values in ignored vault data.
- Read-only requests send bounded note content. Full-note Edit sends the complete note regardless of the context limit. Modify Selection sends the complete selection plus bounded surrounding context, never a truncated selection. Prompts, recent ready chat history for chat requests, vault-root `AGENTS.md`, and directly referenced skills are sent to the selected provider when the user submits. There are no background AI requests; local thread saves perform no networking.
- Ready chats remain local under `<configDir>/emend/chats/`. Do not persist credentials, request bodies, note snapshots, loading/error/stopped messages, or full edit responses. Deleting a note does not automatically delete its thread. Preserve malformed data and never overwrite unsupported schema versions.
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

For a release, run a production build and publish `main.js`, `manifest.json`, and `styles.css` as individual assets. The GitHub release tag should exactly match the manifest version, without a leading `v`. Keep `minAppVersion` and the `versions.json` mapping accurate when adopting newer Obsidian APIs.

Gitea Actions runs lint, tests, and the production build through `.gitea/workflows/ci.yaml`. The unique `emend-macos` label targets the repository's `emend-macos-docker` runner; verify that runner is online before treating a pushed check as actionable. Releases remain manual.
