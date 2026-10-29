# Emend

## Project overview

This repository contains an Obsidian community plugin written in TypeScript and bundled with esbuild. The plugin provides context-aware AI chat, proposed note edits with in-editor diff review, and inline AI suggestions for Markdown notes.

The repository is in an architecture transition:

- The **current implementation and release identity are Emend**. `manifest.json` uses plugin ID `emend`, name `Emend`, and version `1.0.2`; `package.json` is named `emend` at the same version. This is a clean plugin ID with no Lapis Lazuli data migration.
- The current runtime temporarily retains the legacy JSON chat protocol, diff review, and inline suggestions. `IMPLEMENTATION_PLAN.md` describes planned explicit modes, code-level write permissions, CriticMarkup editing, Track Changes integration, streaming, and dynamic skill loading.
- Those planned mechanisms are **not implemented in the current `src/` files**. Do not describe or extend the planned architecture as though it already exists. When implementing the plan, reconcile names, settings, commands, styles, privacy documentation, and tests together.

The manifest requires Obsidian `1.11.4` or newer and sets `isDesktopOnly` to `false`. Keep runtime code compatible with desktop and mobile Obsidian unless that declaration is deliberately changed.

## Technology stack and build process

- TypeScript with strict compiler checks; source files are under `src/`.
- Obsidian API for plugin lifecycle, workspace views, settings, vault access, notices, and HTTP requests.
- CodeMirror 6 (`@codemirror/state` and `@codemirror/view`) for editor extensions, state fields, decorations, and review widgets.
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

`main.js`, source maps, `node_modules/`, and Obsidian's local `data.json` are gitignored. Do not commit generated bundles or local plugin settings.

## Source organization and responsibilities

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle and orchestration: settings loading, chat view and command registration, CodeMirror extension registration, note/context selection, AI request coordination, and accept/reject behavior. |
| `src/chat-view.ts` | Right-sidebar `ItemView`, in-memory chat state, message rendering, composer, copy action, and submission flow. |
| `src/providers.ts` | OpenAI-compatible HTTP requests, prompt construction, temporary chat JSON protocol parsing, response validation, and provider error formatting. |
| `src/settings.ts` | Provider catalog, defaults, persisted-data normalization, and the settings tab. |
| `src/types.ts` | Shared provider, reasoning-effort, and persisted settings types. |
| `src/document-diff-preview.ts` | Line-based LCS diff generation, hunk application/rejection, CodeMirror state field, and diff/review widgets. |
| `src/inline-suggestions.ts` | Inline suggestion state, position mapping across editor changes, loading/ready/error widgets, and accept/reject actions. |
| `styles.css` | Chat, inline suggestion, and diff styles using the `emend-` prefix and Obsidian CSS variables. |
| `esbuild.config.mjs` | Development/watch and production bundle configuration. |
| `eslint.config.mts` | ESLint flat configuration and typed linting. |
| `manifest.json` / `versions.json` | Obsidian release metadata and plugin-version-to-minimum-app-version mapping. |
| `version-bump.mjs` | npm version hook that synchronizes release metadata. |
| `IMPLEMENTATION_PLAN.md` | Proposed Emend rewrite, not a description of current behavior. |

Keep new feature logic in focused modules rather than adding unrelated responsibilities to an already large module. Preserve the current separation between provider transport, editor state, UI, and plugin orchestration.

## Current runtime architecture

### Target note and request context

`main.ts` targets the active Markdown view when available. If focus is in the chat sidebar, it can use the last active still-open Markdown view, then falls back to another open Markdown view. Inline suggestions are stricter and require the active live Markdown editor.

Requests include a bounded Markdown context. Notes within the configured character limit are sent whole; longer notes are windowed around the selection or caret, with `[...]` markers at omitted edges. The default limit is 12,000 characters and the settings UI enforces a minimum of 1,000. Optionally, the vault name and note path are included; this is disabled by default. No instruction file is loaded in the current runtime; automatic instruction and skill discovery is planned for Stage 04.

### Chat and edit review

1. `chat-view.ts` sends the prompt and up to the last eight ready chat messages to `main.ts`.
2. `providers.ts` asks the model to classify the request and return JSON: either an `answer` message or an `edit` containing the complete updated Markdown and an optional summary. A surrounding JSON code fence is tolerated during parsing.
3. Answers appear only in chat. Edit responses do not immediately overwrite the note; `main.ts` computes a line diff and displays it through CodeMirror decorations.
4. The user can accept/reject the whole preview or individual hunks. Accepted changes are dispatched as CodeMirror editor transactions. Chat history and preview state are in memory, not persisted.

The diff currently builds a full longest-common-subsequence table, so large-document edits have quadratic memory/time behavior in the number of lines. Preserve that behavior only knowingly; test performance before changing or expanding whole-document diff use.

### Inline suggestions

The `generate-inline-ai-suggestion` editor command replaces selected text or inserts at the caret. A CodeMirror widget shows loading, output, or errors. `+` accepts a ready suggestion and `-` rejects it. Suggestion offsets are mapped through editor transactions. Starting a new suggestion replaces the current inline suggestion state.

### Providers and settings

DeepSeek, Kimi, and custom providers all use the same OpenAI-compatible chat-completion request. Each provider has an editable base URL, API key, model, and reasoning-effort setting. Requests use Obsidian's `requestUrl`, are non-streaming, and require a configured base URL, API key, and model. Reasoning effort is persisted for the planned streaming transport but is not sent by the legacy request path. Provider errors include HTTP status and available provider details.

Settings are loaded with `loadData()`, normalized against defaults, and saved with `saveData()`. Per-provider configuration, active provider, default mode, note-path inclusion, and context size are stored locally in Obsidian plugin data. The default mode is reserved for the planned mode selector and does not alter the temporary JSON protocol. Chat threads, inline suggestions, and diff previews are not saved there.

## Coding conventions

- Follow the existing TypeScript style: tabs for indentation, single quotes, semicolons, trailing commas where used, and `async`/`await` for asynchronous work.
- Keep strictness intact. `tsconfig.json` enables `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `isolatedModules`, and consistent file-name casing. Handle possibly missing indexed values rather than suppressing these checks.
- Use the Obsidian DOM helpers already used by views/settings and the widget's `ownerDocument` for CodeMirror widgets. Keep user-facing copy short and in sentence case.
- Register views, editor extensions, workspace events, commands, and other disposable resources through Obsidian's registration helpers so unload/reload cleans them up. CodeMirror widgets should keep event handling local and prevent unintended editor interactions, as the current widgets do.
- Use `requestUrl` for provider networking rather than introducing a second HTTP stack until the planned streaming stage. Preserve response validation and useful error propagation.
- Use Obsidian CSS variables and the `emend-` CSS prefix for current UI. Update CSS classes and selectors together.
- Current public identifiers are plugin ID `emend`, view type `emend-chat-view`, chat command ID `emend:open-chat`, and temporary inline command ID `generate-inline-ai-suggestion`. Keep renames consistent and deliberate.
- Avoid Node/Electron-only runtime APIs while `isDesktopOnly` is `false`. Keep startup work limited and avoid unnecessary vault scans or background AI requests.

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

Reload Obsidian and enable the plugin under **Settings → Community plugins**. Configure a provider in the plugin settings. Relevant manual scenarios include:

- Switch among all three providers, edit each provider's settings, reload Obsidian, and verify that the values and non-sensitive preferences persist without reading Lapis Lazuli data.
- Ask a question and confirm that only a chat answer appears and the note remains unchanged.
- Request an edit; verify whole-preview and per-hunk accept/reject behavior, including insertion-only, deletion-only, and replacement hunks.
- Generate inline suggestions with and without selected text; test accept, reject, provider failure, empty output, and edits made while a suggestion is pending.
- Verify long-note context truncation and optional note-path inclusion.
- Test each affected provider with valid configuration and an API error; builds alone cannot validate provider models or network behavior.
- Reload/unload the plugin and check that views, commands, and editor extensions do not duplicate or leak.
- Exercise mobile behavior when changing UI or APIs, since the manifest declares mobile support.

If implementing the Emend plan, replace this checklist's current diff expectations with explicit tests for mode write gating, CriticMarkup output, selection edits, instruction/skill discovery, and Track Changes behavior.

## Security and privacy

- API keys are secrets stored in Obsidian's local plugin data. Never commit `data.json`, print keys, or include them in logs and error messages.
- Note content is sent to the selected third-party provider when the user invokes chat or an inline suggestion. There are no background AI requests in the current implementation.
- The vault/note path is sent only when **Include note path** is enabled. Planned instruction and skill loading must be documented when implemented.
- Current chat edits remain previews until accepted. Do not silently change this to automatic writes; the planned Emend behavior intentionally differs and requires corresponding UX and documentation updates.
- Do not add telemetry, remote code execution, automatic plugin downloads, or unrelated network calls. Keep current file access within the vault and limited to the active note.
- Preserve clear provider error handling without exposing request headers or credentials.

## Versioning and deployment

Use semantic versioning. Running:

```bash
npm version <patch|minor|major>
```

updates `package.json` through npm and invokes the `version` script, which copies `npm_package_version` into `manifest.json`, adds the version and current `minAppVersion` to `versions.json` if absent, and stages those two metadata files. Review the resulting changes rather than editing the files inconsistently.

For a release, run a production build and publish `main.js`, `manifest.json`, and `styles.css` as individual assets. The GitHub release tag should exactly match the manifest version, without a leading `v`. Keep `minAppVersion` and the `versions.json` mapping accurate when adopting newer Obsidian APIs.

Gitea Actions runs lint, tests, and the production build through `.gitea/workflows/ci.yaml`. The unique `emend-macos` label targets the repository's `emend-macos-docker` runner; verify that runner is online before treating a pushed check as actionable. Releases remain manual.
