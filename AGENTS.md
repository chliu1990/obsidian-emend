# Emend

## Project overview

This repository contains an Obsidian community plugin written in TypeScript and bundled with esbuild. The plugin provides context-aware, streamed AI chat for Markdown notes in explicit modes and guarded full-note CriticMarkup editing in Edit mode.

The repository is in an architecture transition:

- The **current implementation and release identity are Emend**. `manifest.json` uses plugin ID `emend`, name `Emend`, and version `1.0.2`; `package.json` is named `emend` at the same version. This is a clean plugin ID with no Lapis Lazuli data migration.
- Ask, Discuss, and Brainstorm modes, instruction/skill loading, and streamed chat are wired into the current runtime. These paths have no note writer.
- Edit mode sends the complete captured note, buffers and validates the CriticMarkup response, guards against stale source or target changes, and writes once through `vault.modify`. Track Changes is the only review surface.
- The dormant diff module, editor extension, callbacks, styles, and CodeMirror dependencies are removed. Selection-only editing remains pending for Stage 09.

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
| `src/main.ts` | Plugin lifecycle and orchestration: settings, chat registration, target-view tracking, context capture, and mode-specific coordinator/writer construction. |
| `src/chat-view.ts` | Right-sidebar `ItemView`, per-session mode, in-memory chat state, streamed Markdown/reasoning rendering, edit summaries, composer, Stop, copy action, and submission flow. |
| `src/context.ts` | Synchronous note snapshots and bounded caret/selection-centered Markdown windows with exact omission markers. |
| `src/request-coordinator.ts` | Writer-free Ask/Discuss/Brainstorm submission and the separate Edit coordinator with full-source prompting, private buffering, reasoning forwarding, validation, and application. |
| `src/note-writer.ts` | The only full-note AI application path: no-op handling, current-source and active-target stale checks, final permission check, and the `vault.read`/`vault.modify` adapter. |
| `src/critic-markup.ts` / `src/edit-strategy.ts` | CriticMarkup parsing, reject-view and sequential-markup validation, edit preparation, and the editing-strategy boundary. |
| `src/provider-stream.ts` | OpenAI-compatible streaming `fetch` transport, SSE parsing, content/reasoning/usage events, and provider error handling. |
| `src/instructions-loader.ts` | Vault-root `AGENTS.md` loading and safe, directly referenced skill discovery. |
| `src/mode.ts` / `src/permissions.ts` | Mode catalog, mode-specific system prompts, and deterministic note-write permission contracts. |
| `src/settings.ts` | Provider catalog, defaults, persisted-data normalization, and the settings tab. |
| `src/types.ts` | Shared provider, mode, message, reasoning-effort, instruction, and persisted settings types. |
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

Read-only requests include bounded Markdown context. Notes within the configured character limit are sent whole; longer notes are windowed around the selection or caret, with `[...]` markers at omitted edges and unused budget redistributed toward available text. The default limit is 12,000 characters and the settings UI enforces a minimum of 1,000. Edit ignores the bounded `markdown` window and always sends `sourceText`, the complete captured note. Vault name and note path are opt-in and disabled by default.

### Streamed chat and guarded editing

1. `chat-view.ts` initializes one in-memory mode from `defaultMode` per view session. Switching notes does not reset the selected mode. Ask, Edit, Discuss, and Brainstorm use their Stage 03 icons, badges, and placeholders.
2. Submission captures context and up to the last eight ready chat messages. Duplicate submissions are disabled while a request is active.
3. `ReadOnlyRequestCoordinator` loads current vault instructions on every request, builds the selected read-only prompt with skills before agent instructions, and calls `requestAiResponse`. Its dependencies and submission contract contain no note writer.
4. Only `EditRequestCoordinator` receives a writer. It uses the full-note CriticMarkup prompt, forwards reasoning while privately buffering content until provider completion, rejects aborts, validates against captured source through Stage 07, and delegates to `applyPreparedEdit`.
5. `applyPreparedEdit` returns without reading or writing for read-only modes and unchanged responses. For a changed Edit response it re-reads the captured file, immediately rechecks the request abort signal, requires both exact source equality and the same active target, checks `canWriteToNote(mode)` immediately before writing, and calls `vault.modify` exactly once. The stale error is `The note changed while Emend was responding. No edits were applied.`
6. Read-only content streams as Markdown through Obsidian `MarkdownRenderer` with the captured file path as source path; streaming renders are throttled to one animation frame and pending frames are cancelled on close. Reasoning is plain text in a closed `details` element. Model output is never assigned with `innerHTML`.
7. Edit responses are never rendered into chat. Success stores only `Edit applied — N changes tracked. Review in Track Changes.` as assistant history; unchanged responses store `No changes were needed.` Valid comment-only edits may apply with zero text changes.
8. Stop aborts the active request. Success, provider errors, validation errors, stale errors, and aborts all clear loading state. Stopped partial responses and errors are excluded from later ready-message history. Chat history is in memory, not persisted.

The legacy JSON answer/edit protocol, accumulating adapters, inline suggestion command/extension/module, inline styles, dormant diff UI, and in-plugin Apply/Reject flow are removed. Track Changes provides the only CriticMarkup review UI. Selection-only editing is not implemented yet.

### Providers and settings

DeepSeek, Kimi, and custom providers all use one OpenAI-compatible streaming chat-completion transport in `provider-stream.ts`. Each provider has an editable HTTP(S) base URL, API key, model, and reasoning-effort setting. Requests use browser `fetch` with `stream: true`, `temperature: 0.3`, the configured `reasoning_effort`, and at most the last eight history messages. Base URLs are trimmed of trailing slashes before `/chat/completions` is appended. Content and reasoning deltas are emitted separately, with optional final token usage and a done event. Provider errors include HTTP status and available provider details without credentials. There is no `requestUrl`, Gemini/Claude transport, provider-specific HTTP implementation, fallback, or retry. `stream_options` is deferred to Stage 14.

Settings are loaded with `loadData()`, normalized against defaults, and saved with `saveData()`. Per-provider configuration, active provider, default mode, note-path inclusion, and context size are stored locally in Obsidian plugin data. Chat threads and stopped/error states are not saved there.

## Coding conventions

- Follow the existing TypeScript style: tabs for indentation, single quotes, semicolons, trailing commas where used, and `async`/`await` for asynchronous work.
- Keep strictness intact. `tsconfig.json` enables `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `isolatedModules`, and consistent file-name casing. Handle possibly missing indexed values rather than suppressing these checks.
- Use Obsidian DOM helpers and `MarkdownRenderer`; keep user-facing copy short and in sentence case. Use the correct window's animation-frame APIs for popout compatibility and never inject model output with `innerHTML`.
- Register views, editor extensions, workspace events, commands, and other disposable resources through Obsidian's registration helpers so unload/reload cleans them up. Abort active chat requests and cancel pending renders when the view closes.
- Use the streaming `fetch` transport in `provider-stream.ts` for provider networking. Do not reintroduce `requestUrl`, a second HTTP stack, provider-specific transports, or silent retries. Preserve response validation and useful credential-safe error propagation.
- Use Obsidian CSS variables and the `emend-` CSS prefix for current UI. Update CSS classes and selectors together.
- Current public identifiers are plugin ID `emend`, view type `emend-chat-view`, and chat command ID `emend:open-chat`. Keep renames consistent and deliberate.
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
- Reject invalid output, stale source edits, and target-note switches without writes. Stop streams and trigger provider errors without partial writes or duplicate submissions.
- Verify unchanged responses do not write, valid comment-only edits may write with zero text changes, sequential edits preserve old markup, and chat history stores summaries rather than annotated documents.
- Inspect mock requests for complete uncapped source in Edit, bounded read-only context, eight-message history, current instruction/skill ordering, and note-path omission/inclusion according to the privacy setting.
- Verify Markdown, links, math, folded reasoning, copy, mode badges/placeholders, model label, per-session mode retention, and close/unload cleanup.
- Exercise desktop streaming behavior when changing provider transport or APIs. Mobile support is not declared while `isDesktopOnly` is `true`.

Stage 09 must add selection editing without reviving the legacy JSON, inline, or in-plugin diff flows.

## Security and privacy

- API keys are secrets stored in Obsidian's local plugin data. Never commit `data.json`, print keys, or include them in logs and error messages. Manual mock credentials must remain dummy values in ignored vault data.
- Read-only requests send bounded note content. Explicit Edit actions send the complete note regardless of the context limit. Prompts, recent ready chat history, vault-root `AGENTS.md`, and directly referenced skills are sent to the selected provider when the user submits chat. There are no background AI requests.
- The vault/note path is sent only when **Include note path** is enabled.
- Ask/Discuss/Brainstorm have no note writer. Only the Edit coordinator receives the guarded writer, which writes validated CriticMarkup immediately after completion and stale checks. Do not add writes outside this permission-gated path or revive automatic legacy JSON edits.
- Do not add telemetry, remote code execution, automatic plugin downloads, or unrelated network calls. Keep current file access within the vault and limited to the active note plus declared instructions/skills.
- Preserve clear provider error handling without exposing request headers or credentials.

## Versioning and deployment

Use semantic versioning. Running:

```bash
npm version <patch|minor|major>
```

updates `package.json` through npm and invokes the `version` script, which copies `npm_package_version` into `manifest.json`, adds the version and current `minAppVersion` to `versions.json` if absent, and stages those two metadata files. Review the resulting changes rather than editing the files inconsistently.

For a release, run a production build and publish `main.js`, `manifest.json`, and `styles.css` as individual assets. The GitHub release tag should exactly match the manifest version, without a leading `v`. Keep `minAppVersion` and the `versions.json` mapping accurate when adopting newer Obsidian APIs.

Gitea Actions runs lint, tests, and the production build through `.gitea/workflows/ci.yaml`. The unique `emend-macos` label targets the repository's `emend-macos-docker` runner; verify that runner is online before treating a pushed check as actionable. Releases remain manual.
