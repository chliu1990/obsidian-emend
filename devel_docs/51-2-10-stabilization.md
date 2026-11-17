# Stage 51: 2.10 bug hunt and stabilization

## Status

In progress on `fix/2.10-write-safety` and its follow-up PR branches. This record accumulates the confirmed findings, focused fixes, regression evidence, and remaining limits for the 2.10 bug-hunt round. Promotion remains blocked until every section below is complete and the final whole-branch review passes.

Baseline for the round: `main` at `0db93f4`, 53 test files / 1,782 tests, lint and build clean.

## Round 1 — independent hunt

Six read-only agents audited independent surfaces: chat view and streaming, composer/control UI, write safety, persistence and sessions, providers/Web/context, and documentation drift. Every blocker was re-verified against source by the controller before triage. Findings are recorded in `docs/superpowers/plans/2026-11-17-emend-2-10-bug-hunt-stabilization.md` with severity and disposition.

Release blockers accepted for this round:

- **H1** Selection edits validated only the selected substring, then spliced the annotated selection into the note. A selection strictly inside an existing CriticMarkup token produced nested markup that `parseCriticMarkup` rejects, and later edits on that note failed terminally.
- **H2** Full-note freshness compared disk bytes with the editor-captured snapshot, so unsaved typing during a request was invisible and `vault.modify` could overwrite it.
- **H3** Structural guards classified only the pre-edit document; an operation payload could open a fence or add an unmatched backtick run, leaving the note partially uneditable.
- **H4** A failed thread load left no usable session, so Send, Enter, New, Rename, and Delete silently did nothing.
- **H5** An invalid stored message was filtered out and the shortened thread was silently rewritten without a backup.
- **H6** A quick action discarded the typed composer draft.
- **H7** A failing legacy-key migration save aborted `onload` before views and commands registered.

## PR A — write-safety hardening

### Fixes

1. `prepareEditResponse` now accepts `validatePrepared`, invoked after a successful `prepareEdit` and inside the same correction branch. `SelectionEditRequestCoordinator` composes `fullText.slice(0, from) + annotatedMarkdown + fullText.slice(to)`, revalidates it with `prepareCriticMarkupEdit`, and converts a rejection into `EditResponseValidationError('compiled-markup-rejected', …)`. The existing single same-provider correction round applies; a second invalid candidate is terminal with zero writes.
2. `NoteWriter` gained optional `readEditorText(file)`. `applyPreparedEdit` requires both disk text and, when available, the live editor text to equal the captured source before `vault.modify`. `main.ts` wires the reader from the maintained target Markdown view and returns `undefined` when no target editor holds the captured file, so the guard adds no vault read and fails closed on concurrent typing.
3. `findPayloadStructureViolation` runs before compilation and requires every fence opener in `insert.text` / `replace.replacement` to have a matching same-character closer of at least the same run length inside the same payload, and every backtick run in those fields to be paired with an equal-length run inside the payload. Violations report `fenced-code-edit` with `field: 'text' | 'replacement'` and take the normal correction round. Balanced code blocks and inline-code pairs remain allowed.

`AGENTS.md` records all three invariants; `IMPLEMENTATION_PLAN.md` links this stage.

### Regression evidence

New tests:

- `tests/selection-editor.test.ts`: `rejects a selection replace that would nest markup inside an existing insertion token`, `applies the corrected candidate after composed-markup rejection`, `does not write when the composed candidate stays invalid`.
- `tests/edit-response.test.ts`: `routes a validatePrepared rejection into the single correction round`.
- `tests/note-writer.test.ts`: `rejects an edit when the open editor text differs from the captured source`, `applies when disk and editor text both match the captured source`, `accepts a disk-only writer when no editor reader is supplied`.
- `tests/main.test.ts`: `wires an editor reader scoped to the target file`.
- `tests/markdown-edit-guards.test.ts`: unbalanced fence insertion, unmatched backtick replacement, balanced code block, inline-code pair.
- `tests/operation-edit-strategy.test.ts`: balanced code-block insertion, unbalanced fence insertion rejected.

RED was reproduced by restoring `src/` from `0db93f4` and running the five focused suites: **14 failed / 331 passed (345)** across all five files. GREEN on the fixed source: all five suites pass, and the full gate reports **53 files / 1,799 tests passed**.

### Local gate

At the PR A head commit with bundle SHA-256 `92f4e4b4d6b0ef1bca78e504635ef76bff399bfea5cf44f053cf416a35656ad9`:

```text
npm test        53 files / 1,799 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit + esbuild production)
git diff --check clean
```

### Limits

PR A is unit- and source-verified. Real-Obsidian confirmation of the composed-markup rejection, concurrent-typing stale rejection, and fence-payload rejection is scheduled in PR E's exploratory matrix; no macOS, Windows, or real-provider evidence is claimed here.

## Remaining sections

PRs B–E append their findings, fixes, RED→GREEN evidence, gates, and the final exploratory matrix below. Stage 51 is not complete until PR E records the whole-round gate and every deferral link.
