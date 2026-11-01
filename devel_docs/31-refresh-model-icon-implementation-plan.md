# Compact Refresh Models Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wide Refresh models text button with an accessible compact Obsidian refresh icon without changing discovery behavior.

**Architecture:** Retain the existing native `ButtonComponent` and refresh orchestration, replacing only its visible text with `refresh-cw`, tooltip, and ARIA metadata. Additive mock fields support focused rendering tests; no custom CSS or new control is needed.

**Tech Stack:** TypeScript, Obsidian ButtonComponent, Vitest, existing Obsidian mocks, real-Obsidian CDP verification.

## Global Constraints

- Work on `feature/refresh-model-icon` for issue #16; no release-version or changelog changes.
- Use exactly icon `refresh-cw`, tooltip `Refresh models`, and `aria-label="Refresh models"`; visible button text must be empty.
- Keep the same nonspinning icon while pending; immediate disabled behavior and final reenabled rerender remain unchanged.
- Do not change `refreshModels()`, discovery, caches, notices, stale-result guards, providers, credentials, storage, notes, or permissions.
- No custom SVG, fixed-width CSS, animation, dependencies, settings, or unrelated redesign.
- Preserve native keyboard accessibility and existing dropdown/custom-model controls.
- Use TDD, independent review, and do not merge without user approval.

## File Structure

- Modify `src/settings.ts`: presentation only.
- Modify `tests/mocks/obsidian.ts`: additive icon/tooltip/ARIA recording.
- Modify `tests/settings.test.ts`: focused icon metadata test plus existing behavior suite.
- Modify `README.md`; create `devel_docs/32-refresh-model-icon.md`: documentation/evidence.
- Modify verification helpers only under ignored `test_vault/`.

---

### Task 1: Icon-only Refresh control

**Files:**
- Modify: `src/settings.ts`
- Modify: `tests/mocks/obsidian.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: existing `addButton()` and `refreshModels(providerId)` behavior.
- Produces: icon-only native button with testable icon, tooltip, and ARIA metadata.

- [ ] **Step 1: Write the failing rendering test**

Using the existing `createModelSettingsTab()`/`latestModelButton()` helpers, add:

```ts
it('renders a compact accessible refresh icon without visible text', () => {
	const { tab } = createModelSettingsTab();
	displaySettings(tab);
	const button = latestModelButton();
	expect(button.icon).toBe('refresh-cw');
	expect(button.tooltip).toBe('Refresh models');
	expect(button.buttonEl.attributes['aria-label']).toBe('Refresh models');
	expect(button.text).toBe('');
});
```

Additively extend the mock `ButtonComponent` with `icon = ''`, `tooltip = ''`, and `buttonEl.attributes: Record<string, string>`; add chainable `setIcon(value)`/`setTooltip(value)` and native-style `setAttribute(name, value)` recording. Keep existing `text`, `disabled`, `clickHandler`, and `setButtonText()` behavior intact.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/settings.test.ts`

Expected: FAIL because icon/tooltip/ARIA are unset and text remains `Refresh models`.

- [ ] **Step 3: Implement the presentation-only replacement**

Replace the existing model-setting `addButton()` callback with:

```ts
.addButton((button) => {
	button.buttonEl.setAttribute('aria-label', 'Refresh models');
	button
		.setIcon('refresh-cw')
		.setTooltip('Refresh models')
		.setDisabled(this.modelRefreshPending)
		.onClick(async () => {
			if (this.modelRefreshPending) return;
			button.setDisabled(true);
			await this.refreshModels(provider.id);
		});
});
```

Do not call `setButtonText()` and do not modify `refreshModels()` or any other setting/control.

- [ ] **Step 4: Run focused and full automated checks**

Run: `npx vitest run tests/settings.test.ts && npm test && npm run lint && npm run build && git diff --check`

Expected: all tests PASS, including every existing pending/discovery test; lint/build and whitespace checks PASS.

- [ ] **Step 5: Commit the icon control**

```bash
git add src/settings.ts tests/mocks/obsidian.ts tests/settings.test.ts
git commit -m "feat: use compact refresh models icon"
```

---

### Task 2: Documentation and real-Obsidian verification

**Files:**
- Modify: `README.md`
- Create: `devel_docs/32-refresh-model-icon.md`
- Modify only under ignored `test_vault/`: existing model-discovery CDP/mock helpers.

**Interfaces:**
- Consumes: Task 1 production bundle and existing sanitized `/models` fixture.
- Produces: current docs and sanitized layout/accessibility/pending evidence.

- [ ] **Step 1: Update current documentation**

Change only the relevant README model-discovery wording to identify the compact **Refresh models** icon. Preserve the explicit `GET /models`, SecretStorage, cache, and custom-model explanations.

- [ ] **Step 2: Verify in real Obsidian**

Use the isolated ignored model-discovery vault/profile, synthetic notes, loopback `/models` mock, and dummy credentials. At wide and narrow settings widths, use actual DOM/computed styles/accessibility evidence and screenshots to verify: no visible text; one `refresh-cw` icon; tooltip and accessible name; no overlap/clipping/stretching/horizontal scrolling; visible keyboard focus and Enter/Space activation; immediate nonspinning pending disable; exactly one request under repeated activation; and enabled success/error completion with unchanged model/cache behavior. Do not use external providers, real credentials, private notes, or the pre-existing Obsidian profile/process.

- [ ] **Step 3: Run the clean final gate**

Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`

Expected: install, all tests, lint, strict TypeScript/esbuild, and whitespace checks PASS.

- [ ] **Step 4: Record and commit evidence**

Create `devel_docs/32-refresh-model-icon.md` with Goal, implementation details, exact commands/results, actual wide/narrow and accessibility/pending observations, behavior preservation, and non-goals. Commit:

```bash
git add README.md devel_docs/32-refresh-model-icon.md
git commit -m "docs: document compact refresh models icon"
```

- [ ] **Step 5: Review and publish the focused PR**

Request independent whole-branch review and address confirmed Critical/Important findings through regression-tested fixes. Push `feature/refresh-model-icon`, open a PR referencing #16 with behavior/non-goals and automated/manual evidence, and verify both GitHub checks with `gh`. Do not merge without user approval.
