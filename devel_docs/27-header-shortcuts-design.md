# Stage 27: header shortcuts and build identity design

## Goal

Make Emend's existing default keyboard shortcuts discoverable in the chat header and show a compact build identity after the title. Release builds display the manifest version; all untagged builds display a short commit hash. Keep the change small, accessible, and independent from history, translation, and provider work.

Tracking issue: https://github.com/chliu1990/obsidian-emend/issues/14

## Scope

This stage includes:

- A title-row build identity and a wrapping default-shortcut row in the existing chat header.
- macOS and Windows/Linux labels generated with Obsidian's public `Platform.isMacOS` API.
- One build-time injected identity string, with an explicit release-workflow opt-in for the manifest version.
- Focused unit/build tests, narrow-sidebar real-Obsidian verification, and current documentation.

This stage does not include new/remapped keybindings, dynamic Obsidian hotkey-manager integration, sidebar-tab title changes, settings, provider behavior, note access, release-version changes, or unrelated visual redesign.

## Current context

`src/chat-view.ts` currently renders `.emend-chat-title` as `Emend` and `.emend-chat-context` as the active-note label. Header CSS only supplies basic typography and spacing. Existing shortcuts are Mod+Shift+A for Ask, Mod+Shift+E for Edit, Enter or Mod+Enter to send, and Shift+Enter for a newline. The Open Emend chat command has no default hotkey and must not be presented as though it has one.

`esbuild.config.mjs` distinguishes production optimization from watch mode, but ordinary CI and release CI both run production builds. Therefore the production flag alone cannot decide whether to show a version. The release workflow already validates `RELEASE_VERSION` against `manifest.json` before building.

## Header presentation

Render a flex title row containing the existing `Emend` title and a smaller muted build-identity span. Below it, render a muted `Default shortcuts` row before the active-note context.

Show these exact labels:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Ask | `⌘⇧A Ask` | `Ctrl+Shift+A Ask` |
| Edit | `⌘⇧E Edit` | `Ctrl+Shift+E Edit` |
| Send | `Enter / ⌘ Enter send` | `Enter / Ctrl+Enter send` |
| Newline | `Shift Enter newline` | `Shift+Enter newline` |

The labels describe Emend's defaults even if the user remaps Obsidian hotkeys. No dynamic remapping support is implied.

Use small muted text with accessible contrast, flexible wrapping, modest gaps, and no fixed header width. Keep individual key/action labels together where practical. Preserve the active-note label's existing single-line ellipsis and prevent horizontal overflow at narrow sidebar widths. Do not change mode controls, composer behavior, loading state, or request rendering.

## Shortcut-label boundary

Add a pure exported helper in `src/chat-shortcuts.ts` that accepts a boolean macOS value and returns ordered key/action label objects. Keeping this helper beside shortcut matching makes the presentation easy to compare with actual defaults and test without DOM rendering.

`chat-view.ts` calls the helper with `Platform.isMacOS`. Extend the Obsidian test mock with the minimal `Platform.isMacOS` export needed by imports. No navigator, Node process, or Electron platform detection is introduced.

## Build identity injection

Inject one string constant named `__EMEND_BUILD_ID__` through esbuild `define`. A small source module declares and exports the constant for UI use; Vitest receives a deterministic test value through its own `define` configuration.

At build time:

1. If `EMEND_RELEASE_BUILD` is exactly `1`, read `manifest.json` and use its complete semantic version, currently `2.1.0`.
2. Otherwise execute `git rev-parse --short HEAD` with `execFileSync()` and argument arrays, trim the result, and use that short hash.
3. Reject an empty identity rather than injecting an undefined/blank label.
4. JSON-encode the selected value for esbuild.

Development watch mode captures the hash when the esbuild context starts; restart it after a commit to advance the displayed hash. Dirty working-tree changes do not alter the hash. No runtime Git, filesystem, Node, network, or repository access is added to the plugin.

## Release workflow

Set `EMEND_RELEASE_BUILD=1` only in `.github/workflows/release.yaml` for the build step, after the existing release-version validation step. Release builds therefore show the validated manifest version even when a manual workflow-dispatch release creates the tag later.

Do not set the variable in ordinary CI. Local development, local production builds, and untagged CI production builds all show the short commit hash.

## Tests and build verification

Add pure tests for both complete platform label sets, order, action names, and absence of an Open-chat hotkey label. Add a deterministic test for the injected build-info module. Extend mocks only as needed for these imports.

Verify actual bundles rather than relying only on unit tests:

- Development/watch build identity equals `git rev-parse --short HEAD`.
- Ordinary `npm run build` identity also equals that hash.
- `EMEND_RELEASE_BUILD=1 npm run build` identity equals `manifest.json.version`.
- The bundle contains no runtime `git`, `execFileSync`, or filesystem build-metadata path.

Run the full test suite, lint, production build, and `git diff --check`. CI must pass with the release-workflow change.

## Real-Obsidian verification

Use an isolated ignored vault/profile and synthetic notes only. Install and inspect:

1. An untagged production build whose title identity equals the current short HEAD hash.
2. A release-mode build whose title identity equals the manifest version.
3. macOS default-shortcut labels, with non-mac labels covered by unit tests and platform-helper evidence.
4. Normal and narrow sidebar widths, long note names, wrapped shortcuts, readable contrast, and no horizontal overflow.
5. Mode changes, note changes, and request-state rerenders retaining the same identity and labels.

Record sanitized observations and build identifiers in the implementation stage document. No real credentials or provider request is needed.

## Documentation and delivery

Update README with the default-shortcut display and build-identity meaning, including the development-watch restart behavior. Reference issue #14 in the focused PR. Record implementation and verification evidence in a separate numbered stage document. Do not bump versions or update release changelog metadata in this feature PR.
