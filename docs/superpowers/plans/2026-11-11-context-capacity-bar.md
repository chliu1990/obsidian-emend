# Context Capacity Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-heavy capacity meter with a compact header progress bar whose output allowance shrinks as estimated input grows.

**Architecture:** Keep the existing estimate builders, blocking, and refresh wiring. Replace only `ContextCapacityDisplay`'s presentation with a pure bar model and a focusable segmented bar plus hover/focus floating details, then move it from the composer to the header and reuse it in the selection modal.

**Tech Stack:** TypeScript strict, Obsidian desktop DOM/CSS, Vitest, ESLint, esbuild, real-Obsidian loopback harness.

**Spec:** `docs/superpowers/specs/2026-11-11-context-capacity-bar-design.md`

## Global Constraints

- No additional-note/instruction estimation, gray unknown segment, compact-context button, compression, new provider calls, or new vault reads.
- Remaining input = `max(0, W − R − I)`; remaining output = `max(0, min(R, W − I))`.
- Known categories only: system, draft, history, tools, continuation. Unknown content appears only as an explanatory note inside floating details.
- No meter below the composer; the bar is below the mode controls, and the same component appears below the selection-modal title.
- Existing exact preflight, invalid/over-capacity blocking, refresh triggers, and modal Notice-only behavior stay unchanged.
- TypeScript strict, tabs, single quotes, semicolons, `noUncheckedIndexedAccess`; Obsidian CSS variables and `emend-` classes.

## Review Focus

- Input at/below/above `W − R`: output reserve stays `R` below, shrinks above, and reaches zero at `W`.
- Input greater than `W`: no CSS overflow; the bar is marked over capacity and `aria-valuenow` is capped at `W`.
- Unconfigured and invalid settings: no fabricated proportional window or output segment.
- Keyboard/touch accessibility: focus reveals details, click pins, Escape/outside click dismisses, pointer exit/focus loss hides an unpinned panel.
- Repeated refresh while details are open updates values without closing the panel or re-announcing static content.

---

### Task 1: Pure bar model, floating display, and header/modal integration

**Files:**
- Modify: `src/context-capacity-ui.ts`
- Modify: `src/chat-view.ts`
- Modify: `src/selection-modal.ts`
- Modify: `styles.css`
- Test: `tests/context-capacity-ui.test.ts`
- Test: `tests/chat-view.test.ts`
- Test: `tests/selection-modal.test.ts`

**Interfaces:**
- Consumes: existing `DraftCapacityEstimate`, `ContextCapacityState`, `RequestCharacterCategories`, and `ContextCapacityDisplay.render(estimate)` / `destroy()`.
- Produces:

```ts
export interface ContextCapacityBarSegment {
  key: 'system' | 'user' | 'history' | 'tools' | 'continuation' | 'free' | 'output';
  tokens: number;
  fraction: number;
}

export interface ContextCapacityBarModel {
  estimatedInputTokens: number;
  effectiveInputTokens?: number;
  remainingInputTokens?: number;
  remainingOutputTokens?: number;
  segments: ContextCapacityBarSegment[];
}

export function buildContextCapacityBarModel(
  estimate: DraftCapacityEstimate,
): ContextCapacityBarModel;
```

- [ ] **Step 1: Write failing pure-model tests**

Pin valid states `W=100, R=20`:
- `I=60` → remaining input `20`, remaining output `20`; known segments use `tokens / 100`; `free=.2`, `output=.2`.
- `I=80` → remaining input `0`, remaining output `20`.
- `I=90` → remaining input `0`, remaining output `10`.
- `I=100` → remaining output `0`.
- `I=120` → no fraction exceeds `1`, segment fractions sum to `1`, remaining output `0`.
- unconfigured → no `effectiveInputTokens`/remaining values and no proportional segments; invalid likewise.
- `continuation` appears only when nonzero.

- [ ] **Step 2: Verify RED**

Run `npx vitest run tests/context-capacity-ui.test.ts`; expected failure: `buildContextCapacityBarModel` does not exist.

- [ ] **Step 3: Implement the model and replace the display**

Implement the interface above. Use `I = estimate.categories.estimatedInputTokens`; for valid capacity, `W` and `R` come from the state. Fractions use `Math.max(W, I)` as denominator so overflow never exceeds the layout. Do not add an unknown segment.

Replace the old text/details DOM with:
- a focusable `emend-context-capacity` wrapper;
- a slim `role="meter"` bar with `aria-valuemin="0"`, `aria-valuemax=W`, `aria-valuenow=min(I,W)`, and an `aria-valuetext` summary;
- colored known segments, muted `free`, and distinct `output`;
- a hidden floating `role="tooltip"` details panel showing estimated input, remaining input/output, effective capacity, window/reserve, category values, and the lower-bound/unmeasured note.

For unconfigured, show `Estimated input: N tokens. Capacity checks are off.` without a proportional bar. For invalid, show the existing authoritative invalid message. For unavailable, show `Draft estimate unavailable.`

Pointer enter/focus in shows details; pointer leave/focus out hides an unpinned panel; click pins/unpins; Escape/outside click dismisses. Refreshing while open updates the panel without closing it. Only the changing summary is `role="status"`/`aria-live="polite"`.

- [ ] **Step 4: Move the displays**

In `chat-view.ts`, create the display immediately after the mode selector and before messages, not in `composerEl`. In `selection-modal.ts`, create it at the top of `contentEl` before quick actions. Preserve all existing refresh/block calls and `destroy()` behavior.

Add compact segmented-bar, output, over/invalid, floating-details, and narrow-layout styles using Obsidian color variables. No compact-context button.

- [ ] **Step 5: Update and run display/integration tests**

Assert the new DOM/ARIA/fractions, hover/focus/click/Escape/outside behavior, refresh while open, absence of the composer meter, modal placement, and all existing capacity blocking behavior. Run `npx vitest run tests/context-capacity-ui.test.ts tests/chat-view.test.ts tests/selection-modal.test.ts`; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context-capacity-ui.ts src/chat-view.ts src/selection-modal.ts styles.css tests/context-capacity-ui.test.ts tests/chat-view.test.ts tests/selection-modal.test.ts
git commit -m "Show context capacity as a compact header progress bar"
```

---

### Task 2: Documentation and real-Obsidian verification

**Files:**
- Modify: `devel_docs/42-context-accounting-capacity.md`
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `README.md`
- Modify: `QUICK_START.md`
- Ignored harness: `test_vault/emend-selection-chat-verify/verify.mjs`

**Interfaces:**
- Consumes Task 1's `buildContextCapacityBarModel`, new header bar, and floating details.

- [ ] **Step 1: Update harness assertions and run real Obsidian**

Assert the header bar exists below mode controls, no composer meter remains, known segments and right-hand output partition shrink at the expected capacity boundary, unconfigured/invalid states have no fabricated partition, hover/focus shows floating details, and narrow layout does not overflow. Include the existing documented-defaults scenario.

Run `npm run build` then `node test_vault/emend-selection-chat-verify/verify.mjs`; record actual scenario/assertion counts and loaded bundle hash. Use only the loopback mock and dummy credential.

- [ ] **Step 2: Update documentation**

Describe the header bar, formulas, unmeasured-exclusion note, hover/focus details, and omitted compact button in Stage 42, AGENTS, IMPLEMENTATION_PLAN, README, and QUICK_START. Do not claim additional-note estimation or compression.

- [ ] **Step 3: Run the full gate and commit**

Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; record actual counts and gate commit in Stage 42. Ensure no unrelated generated files are committed. Commit docs and any harness-required tracked changes.
