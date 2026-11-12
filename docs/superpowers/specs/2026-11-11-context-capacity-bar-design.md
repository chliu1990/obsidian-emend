# Context capacity progress bar design

## Intent

Replace the text-heavy Draft estimate below the composer with a compact context-capacity bar below the chat header's mode controls, matching `docs/images/emend-context-bar.jpg`. Daily use shows only the bar; numbers and the exclusion warning appear as floating details on hover or keyboard focus. The selection modal uses the same compact presentation below its title. The mockup's compact-context button is omitted because compression is deferred.

## Goals

- Show known input composition, remaining input, and the adjustable output allowance in one narrow bar.
- Remove the composer text estimate, folded details, and always-visible exclusion paragraph.
- Preserve the existing estimator, refresh triggers, invalid/over-capacity blocking, exact preflight, and modal Notice-only result behavior.
- Make remaining-output adjustment explicit as input grows.

## Non-goals / anti-goals

- No numeric estimate for additional-note contents, instructions/skills, or later Web/correction rounds; no new vault reads or provider calls.
- **No gray "unknown input" segment.** Unknown content is explained only in floating details and is not assigned a misleading width.
- **No compact-context button.** The mockup's compact action would trigger context compression, which is explicitly deferred; do not add a dead or misleading control.
- No proportional bar when no context window is configured.

## Approaches considered

1. **Known-only bar (chosen).** Show measured categories and the configured output reserve; unknown content is omitted from the bar and noted only in details. No additional-note estimation or background reads.
2. On-demand additional-note estimation when details open. Rejected as unnecessary asynchronous reads and stale/cancellation state for an optional detail view.
3. Gray unknown-input segment. Rejected after the user's cleanup direction: an unmeasured segment cannot have an honest proportional width.

## Capacity model

Let `W` be the configured context window, `R` the output reserve, and `I` the current estimated input.

- Remaining input = `max(0, W − R − I)`.
- Remaining output = `max(0, min(R, W − I))`.
- The right-hand output partition is `R` while input fits within `W − R`; it shrinks when input consumes that allowance, and becomes zero when input reaches the full window.
- Input at or above `W − R` is already blocked by the existing guard and is shown as over capacity even if some output remains.
- Segment widths are proportional to `W`; overflow is visually flagged rather than allowed to overflow the layout.
- With no configured window, show estimated input text and no proportional total-window bar or output-reserve partition.

These are estimates from the current known categories. Remaining input is a lower-bound estimate because excluded content is unmeasured; details must not call it exact.

## Presentation

- Full-width slim bar at the bottom of the chat header, after the mode controls and before messages. No meter remains below the composer textarea.
- Colored segments for system, draft, history, tools, and continuation (when nonzero); muted free-input space; distinct right-hand output-allowance partition. Use Obsidian color variables with accessible contrast and `emend-` classes.
- The bar is focusable. Hovering it or moving keyboard focus into it reveals a floating details panel (tooltip-style) beside/below the bar; pointer exit or focus loss hides it. Clicking/tapping pins it for touch users, and Escape or an outside click dismisses it. It is hidden by default and has no details button.
- Details show estimated input, remaining input, remaining output, effective input capacity, window/reserve, category token values, and one short note that additional-note contents, instructions/skills, the first Web round's system prompt/tools, and later Web/correction rounds are unmeasured.
- The changing summary alone is a polite live status region; the static bar and details are not re-announced on every refresh.
- Over-capacity and invalid states retain the existing block behavior and concise warning text.

## Implementation boundaries

- Rework `ContextCapacityDisplay` rendering and add a pure bar-model helper for the formulas; keep the existing `render(estimate)`/`destroy()` API and all refresh/block wiring.
- Move the composer display from below the textarea to the bottom of the header; place the same component below the selection-modal title and remove the modal's old text block.
- Update unit tests for the formulas, segment widths, ARIA state, hover/focus/pinned details, and no composer meter. Update the loopback harness for the new DOM, floating details, output shrinkage, and narrow layout; rerun it.
- Update README, QUICK_START, AGENTS, IMPLEMENTATION_PLAN, and Stage 42 evidence. No CHANGELOG changes and no new runtime dependency.

## Builder discretion

- Exact colors, spacing, floating-panel placement, and small-screen behavior may be adjusted to match Obsidian's native controls and avoid clipping.
