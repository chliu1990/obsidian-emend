# Header Shortcuts and Build Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Emend's default keyboard shortcuts and a build-time version/commit identity in the chat header with accessible narrow-sidebar behavior.

**Architecture:** esbuild injects one `__EMEND_BUILD_ID__` string selected from the manifest only for release-workflow builds, otherwise from the short Git HEAD. A pure shortcut-label helper feeds the existing chat header; flexible CSS supplies layout without changing keybindings or request behavior.

**Tech Stack:** TypeScript, Obsidian `Platform`, esbuild `define`, Vitest, CSS, GitHub Actions.

## Global Constraints

- Work on `feature/header-shortcuts` for issue #14; do not change release versions or changelog metadata.
- Show default shortcuts only; do not add/change keybindings or access Obsidian hotkey-manager internals.
- Exact release identity is `manifest.json.version`; every untagged build uses `git rev-parse --short HEAD` at build time.
- Set `EMEND_RELEASE_BUILD=1` only in the release workflow build step after version validation.
- No runtime Git, filesystem, Node, network, or repository access.
- Use Obsidian `Platform.isMacOS`; do not use navigator/process platform detection.
- Preserve the active-note label, mode controls, request rendering, and all current behavior.
- No dependencies, settings, provider changes, note access, or unrelated UI redesign.
- Use focused TDD commits and independent review; do not merge the PR without user approval.

## File Structure

- Create `src/build-info.ts` and `tests/build-info.test.ts`: injected identity boundary.
- Modify `esbuild.config.mjs`, `vitest.config.ts`, `.github/workflows/release.yaml`: build-time selection and release opt-in.
- Modify `src/chat-shortcuts.ts`, `src/chat-view.ts`, `styles.css`: labels and presentation.
- Modify `tests/chat-shortcuts.test.ts`, `tests/chat-view.test.ts`, `tests/mocks/obsidian.ts`: platform and style evidence.
- Modify `README.md`; create `devel_docs/29-header-shortcuts.md`: current behavior and verification evidence.
- Create verification scripts only under ignored `test_vault/`.

---

### Task 1: Build identity injection

**Files:**
- Create: `src/build-info.ts`, `tests/build-info.test.ts`
- Modify: `esbuild.config.mjs`, `vitest.config.ts`, `.github/workflows/release.yaml`

**Interfaces:**
- Consumes: `manifest.json.version`, `EMEND_RELEASE_BUILD`, and Git HEAD at build time.
- Produces: exported `EMEND_BUILD_ID: string` for the header task.

- [ ] **Step 1: Write the failing deterministic injection test**

Create `tests/build-info.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMEND_BUILD_ID } from '../src/build-info';

describe('build identity', () => {
	it('exposes the deterministic value injected by the test build', () => {
		expect(EMEND_BUILD_ID).toBe('test-build');
	});
});
```

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/build-info.test.ts`

Expected: FAIL because `src/build-info.ts` does not exist.

- [ ] **Step 3: Implement build-time selection**

Create `src/build-info.ts`:

```ts
declare const __EMEND_BUILD_ID__: string;

export const EMEND_BUILD_ID = __EMEND_BUILD_ID__;
```

Add to Vitest's top-level config:

```ts
define: {
	__EMEND_BUILD_ID__: JSON.stringify('test-build'),
},
```

In `esbuild.config.mjs`, import `execFileSync` from `node:child_process` and `readFileSync` from `node:fs`. Before creating the context, compute:

```ts
const manifest = JSON.parse(
	readFileSync(new URL('manifest.json', import.meta.url), 'utf8'),
) as { version: string };
const buildId = process.env.EMEND_RELEASE_BUILD === '1'
	? manifest.version.trim()
	: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
		encoding: 'utf8',
	}).trim();
if (!buildId) {
	throw new Error('Emend build identity must not be empty.');
}
```

Add to the esbuild context:

```ts
define: {
	__EMEND_BUILD_ID__: JSON.stringify(buildId),
},
```

Change only the release workflow build step to:

```yaml
      - run: npm run build
        env:
          EMEND_RELEASE_BUILD: '1'
```

- [ ] **Step 4: Run injection and existing tests**

Run: `npx vitest run tests/build-info.test.ts tests/settings.test.ts`

Expected: PASS, including the existing 2.1.0 publication metadata assertions.

- [ ] **Step 5: Commit build identity**

```bash
git add src/build-info.ts tests/build-info.test.ts esbuild.config.mjs vitest.config.ts .github/workflows/release.yaml
git commit -m "feat: inject build identity"
```

---

### Task 2: Header shortcuts and build presentation

**Files:**
- Modify: `src/chat-shortcuts.ts`, `src/chat-view.ts`, `styles.css`
- Modify: `tests/chat-shortcuts.test.ts`, `tests/chat-view.test.ts`, `tests/mocks/obsidian.ts`

**Interfaces:**
- Consumes: `EMEND_BUILD_ID` from Task 1.
- Produces: `getDefaultShortcutLabels(isMacOS: boolean): ShortcutLabel[]` and the actual header UI.

- [ ] **Step 1: Write failing platform-label and CSS tests**

Add to `tests/chat-shortcuts.test.ts`:

```ts
it('labels all default shortcuts for macOS', () => {
	expect(getDefaultShortcutLabels(true)).toEqual([
		{ keys: '⌘⇧A', action: 'Ask' },
		{ keys: '⌘⇧E', action: 'Edit' },
		{ keys: 'Enter / ⌘ Enter', action: 'send' },
		{ keys: 'Shift Enter', action: 'newline' },
	]);
});

it('labels all default shortcuts for Windows and Linux', () => {
	expect(getDefaultShortcutLabels(false)).toEqual([
		{ keys: 'Ctrl+Shift+A', action: 'Ask' },
		{ keys: 'Ctrl+Shift+E', action: 'Edit' },
		{ keys: 'Enter / Ctrl+Enter', action: 'send' },
		{ keys: 'Shift+Enter', action: 'newline' },
	]);
});
```

Import the new helper. In `tests/chat-view.test.ts`, use `getCssRule()` to assert `.emend-chat-title-row` and `.emend-chat-shortcuts` contain `flex-wrap: wrap;`, `.emend-chat-build` and `.emend-chat-shortcuts` use `color: var(--text-muted);`, and `.emend-chat-context` retains `text-overflow: ellipsis;`.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/chat-shortcuts.test.ts tests/chat-view.test.ts`

Expected: FAIL because the helper and new CSS selectors do not exist.

- [ ] **Step 3: Implement labels and header rendering**

Add to `src/chat-shortcuts.ts`:

```ts
export interface ShortcutLabel {
	keys: string;
	action: string;
}

export function getDefaultShortcutLabels(isMacOS: boolean): ShortcutLabel[] {
	return [
		{ keys: isMacOS ? '⌘⇧A' : 'Ctrl+Shift+A', action: 'Ask' },
		{ keys: isMacOS ? '⌘⇧E' : 'Ctrl+Shift+E', action: 'Edit' },
		{ keys: isMacOS ? 'Enter / ⌘ Enter' : 'Enter / Ctrl+Enter', action: 'send' },
		{ keys: isMacOS ? 'Shift Enter' : 'Shift+Enter', action: 'newline' },
	];
}
```

Import `Platform` from Obsidian, `EMEND_BUILD_ID`, and the helper in `chat-view.ts`. Replace only the title block with:

```ts
const titleRowEl = headerEl.createDiv('emend-chat-title-row');
titleRowEl.createDiv({ cls: 'emend-chat-title', text: 'Emend' });
titleRowEl.createSpan({ cls: 'emend-chat-build', text: EMEND_BUILD_ID });
const shortcutsEl = headerEl.createDiv('emend-chat-shortcuts');
shortcutsEl.createSpan({
	cls: 'emend-chat-shortcuts-label',
	text: 'Default shortcuts',
});
for (const shortcut of getDefaultShortcutLabels(Platform.isMacOS)) {
	shortcutsEl.createSpan({
		cls: 'emend-chat-shortcut',
		text: `${shortcut.keys} ${shortcut.action}`,
	});
}
```

Add `Platform = { isMacOS: true }` to the Obsidian mock. Add CSS with `display: flex`, `flex-wrap: wrap`, baseline/center alignment and modest gaps for the title/shortcut rows; smaller muted text for identity/shortcuts; `min-width: 0`; and no fixed width. Keep `.emend-chat-title` typography and `.emend-chat-context` ellipsis unchanged.

- [ ] **Step 4: Run focused tests and the full gate**

Run: `npx vitest run tests/chat-shortcuts.test.ts tests/chat-view.test.ts tests/build-info.test.ts && npm test && npm run lint && npm run build && git diff --check`

Expected: all tests PASS, lint/build succeed, and no whitespace errors.

- [ ] **Step 5: Verify untagged and release bundle identities**

Run `npm run build`, then use a Node assertion that `main.js` contains the exact short `git rev-parse --short HEAD` value. Run `EMEND_RELEASE_BUILD=1 npm run build`, then assert the bundle contains the exact manifest version and that build-only imports such as `execFileSync` are absent. Record the actual identifiers for Task 3.

- [ ] **Step 6: Commit the header UI**

```bash
git add src/chat-shortcuts.ts src/chat-view.ts styles.css tests/chat-shortcuts.test.ts tests/chat-view.test.ts tests/mocks/obsidian.ts
git commit -m "feat: show shortcuts and build identity in header"
```

---

### Task 3: Documentation and real-Obsidian verification

**Files:**
- Modify: `README.md`
- Create: `devel_docs/29-header-shortcuts.md`
- Create only under ignored `test_vault/`: isolated vault/profile and CDP verification helpers.

**Interfaces:**
- Consumes: Tasks 1–2 production and release-mode bundles.
- Produces: user-facing documentation and reproducible sanitized UI evidence.

- [ ] **Step 1: Update current documentation**

Document the visible default shortcuts, macOS/other modifier labels, manifest-version versus short-hash identity, and the need to restart development watch after a commit. Do not claim dynamic remapped-hotkey support.

- [ ] **Step 2: Verify build modes and real Obsidian**

Confirm an ordinary development build and untagged production build show the current short HEAD. Confirm `EMEND_RELEASE_BUILD=1 npm run build` shows the manifest version. Install both forms successively in an isolated ignored real-Obsidian vault/profile and use CDP screenshots/DOM/computed-style assertions for title identity, macOS shortcut labels, normal/narrow widths, long-note ellipsis, no horizontal overflow, and stable labels after mode/note/request-state rerenders. No provider request or real credential is needed.

- [ ] **Step 3: Run the clean final gate**

Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`

Expected: lockfile install, all tests, lint, strict TypeScript/esbuild, and whitespace checks PASS.

- [ ] **Step 4: Record and commit evidence**

Create `devel_docs/29-header-shortcuts.md` with Goal, implementation details, exact build identifiers/commands/results, real-Obsidian observations, accessibility/layout impact, and non-goals. Commit:

```bash
git add README.md devel_docs/29-header-shortcuts.md
git commit -m "docs: document header shortcuts and build identity"
```

- [ ] **Step 5: Independent review and PR**

Dispatch a fresh reviewer for the complete diff and address confirmed Critical/Important findings through regression-tested fixes. Push `feature/header-shortcuts`, open a PR referencing #14 with behavior/non-goals, build-mode evidence, automated results, and real-Obsidian evidence. Verify the required GitHub `check` with `gh`; do not merge without user approval.

---

### Task 4: Shortcut badges and grouped rows

**Files:**
- Modify: `src/chat-view.ts`, `styles.css`, `tests/chat-view.test.ts`
- Modify: `devel_docs/29-header-shortcuts.md`
- Modify only under ignored `test_vault/`: existing Stage 27 CDP verification helpers.

**Interfaces:**
- Consumes: existing ordered `getDefaultShortcutLabels()` output.
- Produces: semantic `<kbd>` key badges with separate action text in two wrapping groups.

- [ ] **Step 1: Write failing CSS regression assertions**

Extend the existing `getCssRule()` tests to require `.emend-chat-shortcuts` with `flex-direction: column;`, `.emend-chat-shortcut-group` with `display: flex;` and `flex-wrap: wrap;`, and `.emend-chat-shortcut kbd` with all of:

```css
border: 1px solid var(--background-modifier-border);
background: var(--background-secondary);
color: var(--text-normal);
```

Also require `.emend-chat-shortcut` with `display: inline-flex;` and `align-items: center;` so each badge stays paired with its action.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/chat-view.test.ts`

Expected: FAIL because the grouped-row and `<kbd>` selectors do not exist.

- [ ] **Step 3: Implement grouped semantic badges**

Replace the current single shortcut loop in `chat-view.ts` with:

```ts
const shortcutsEl = headerEl.createDiv('emend-chat-shortcuts');
const modeGroupEl = shortcutsEl.createDiv('emend-chat-shortcut-group');
modeGroupEl.createSpan({
	cls: 'emend-chat-shortcuts-label',
	text: 'Default shortcuts',
});
const composerGroupEl = shortcutsEl.createDiv('emend-chat-shortcut-group');
for (const [index, shortcut] of getDefaultShortcutLabels(Platform.isMacOS).entries()) {
	const groupEl = index < 2 ? modeGroupEl : composerGroupEl;
	const itemEl = groupEl.createSpan({ cls: 'emend-chat-shortcut' });
	itemEl.createEl('kbd', { text: shortcut.keys });
	itemEl.createSpan({ text: shortcut.action });
}
```

Keep the note context immediately after these groups. Change `.emend-chat-shortcuts` to a column with `align-items: flex-start` and a 3px gap. Add:

```css
.emend-chat-shortcut-group {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 8px;
	min-width: 0;
}

.emend-chat-shortcut {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	white-space: nowrap;
}

.emend-chat-shortcut kbd {
	padding: 0 3px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 3px;
	background: var(--background-secondary);
	color: var(--text-normal);
	font: inherit;
	line-height: 1.4;
}
```

Do not style action text as a badge or change any labels/keybindings.

- [ ] **Step 4: Run focused and full automated checks**

Run: `npx vitest run tests/chat-view.test.ts tests/chat-shortcuts.test.ts && npm test && npm run lint && npm run build && git diff --check`

Expected: all tests PASS, lint/build succeed, and no whitespace errors.

- [ ] **Step 5: Commit the UI refinement**

```bash
git add src/chat-view.ts styles.css tests/chat-view.test.ts
git commit -m "fix: distinguish shortcut keys from actions"
```

- [ ] **Step 6: Repeat real-Obsidian visual verification**

Install the updated untagged build in the isolated Stage 27 vault. Capture normal 420px and narrow 220px screenshots and assert four `<kbd>` elements in order, exact key/action text, two groups, separate action spans, badge background/border/text colors, internal wrapping without horizontal overflow, and unchanged title identity/note context. Use synthetic notes only.

- [ ] **Step 7: Record evidence and update PR #17**

Append the refinement implementation and actual screenshot/DOM results to `devel_docs/29-header-shortcuts.md`, commit `docs: record shortcut badge verification`, push the branch, request focused re-review, and confirm both GitHub checks pass. Do not merge without user approval.
