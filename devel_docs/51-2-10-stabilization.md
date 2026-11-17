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
2. `NoteWriter` gained optional `readEditorText(file)`. `applyPreparedEdit` requires both disk text and, when available, the live editor text to equal the captured source before `vault.modify`. `main.ts` inspects every open Markdown view that holds the captured file and returns the first text differing from the target view's text (otherwise the target text, or `undefined` when no view holds the file), so a second pane with unsaved edits also fails closed. The guard adds no vault read.
3. `findPayloadStructureViolation` runs after replacement compilation and before final CriticMarkup validation. It compiles each payload the way it will be written — `{++text++}`, `{~~target~>replacement~~}`, `{>>comment<<}` — and requires every fence opener inside that wrapper to close on a later line that is followed by a line break inside the wrapper; a closer sharing the wrapper's last line rejects because the appended delimiter re-opens the fence. Every backtick run in the payload must pair with an equal-length run, and the runs between a matched pair count as span content, so nested spans such as `` ``a`b`` `` stay valid. Violations report `fenced-code-edit` with `field: 'text' | 'replacement' | 'comment'` and take the normal correction round. Balanced code blocks that end in a line break inside the payload remain allowed.
4. The payload diagnostic message now distinguishes payload-introduced structure from pre-edit fenced-code classification: `Operation N payload introduces unbalanced fenced code or backtick runs at line L; keep every fence and backtick run paired inside the operation payload. No edits were applied.`

`AGENTS.md` records all four invariants; `IMPLEMENTATION_PLAN.md` links this stage.

### Regression evidence

New tests:

- `tests/selection-editor.test.ts`: `rejects a selection replace that would nest markup inside an existing insertion token`, `applies the corrected candidate after composed-markup rejection`, `does not write when the composed candidate stays invalid`.
- `tests/edit-response.test.ts`: `routes a validatePrepared rejection into the single correction round`.
- `tests/note-writer.test.ts`: `rejects an edit when the open editor text differs from the captured source`, `applies when disk and editor text both match the captured source`, `accepts a disk-only writer when no editor reader is supplied`.
- `tests/main.test.ts`: `wires an editor reader scoped to the target file`, `rejects an edit when another open view of the target file has different text`.
- `tests/markdown-edit-guards.test.ts`: unbalanced fence insertion, unmatched backtick replacement, balanced code block, inline-code pair, nested backtick span, closer sharing the wrapper line, balanced block followed by a newline, comment payload opening a fence, removal and balanced-comment payloads.
- `tests/operation-edit-strategy.test.ts`: balanced code-block insertion, unbalanced fence insertion rejected, `routes an unbalanced fence insertion through the single correction round`.

RED was reproduced by restoring `src/` from `0db93f4` and running the five focused suites: **14 failed / 331 passed (345)** across all five files. GREEN on the fixed source: all five suites pass, and the full gate reports **53 files / 1,799 tests passed**.

## Independent review round

A fresh reviewer audited the PR A diff (`0db93f4..9cb65aa`) and found one Important hole and three smaller gaps.

- **Important — payload-only scanning.** Payload structure was scanned before compilation, so it never saw the wrapper that is appended to the last payload line. `text: '\n```\ncode\n```'` composed to `{++…```++}`, where ` ```++}` is a valid opener with info string `++}` and can never be a closer, leaving an unclosed fence to EOF. Fixed by scanning the compiled wrapper and requiring the closer to be followed by a line break inside the payload.
- **Minor — nested code spans.** Runs of 2, 1, 2 (a double-backtick span containing a single backtick) were rejected because the inner run had no equal-length partner. Fixed by marking every run between a matched pair as span content.
- **Minor — multi-pane freshness.** The editor reader consulted only the maintained target view, so a second open pane of the same file could hold different unsaved text. Fixed by inspecting every open Markdown view for the captured file and returning the first text that differs from the target view's text.
- **Diagnostics/docs.** The payload diagnostic now covers `field: 'comment'` and names the payload (not "inserted text"); the stage plan, `AGENTS.md` module rows, and the Stage 51 record describe the actual order and behavior. `MarkdownEditViolation['field']` already admitted `'comment'` from Stage 38, and `formatEditValidationFeedback` already allowed it, so no type change was needed.

Focused RED for this round — `npx vitest run tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/main.test.ts` — reproduced five failures: the closer-shares-the-wrapper-line insertion returned `undefined`, the comment-fence payload returned `undefined`, the nested backtick span was rejected, the unbalanced insertion applied through the coordinator, and a second open view of the target file with different text still wrote. GREEN after the fixes: **53 files / 1,805 tests passed**.

### Local gate

At the reviewed PR A head (`05f199a`, after the hardening round) with bundle SHA-256 `90a09311a1e3f848562f127bc1de92e355e32df3db5b19b71a045db06f7b657d`:

```text
npm test        53 files / 1,805 tests passed
npm run lint    clean
npm run build   clean (tsc -noEmit + esbuild production)
git diff --check clean
```

The pre-review PR A head (bundle `92f4e4b4…`) reported **53 files / 1,799 tests**.

### Limits

PR A is unit- and source-verified. Real-Obsidian confirmation of the composed-markup rejection, concurrent-typing stale rejection, and fence-payload rejection is scheduled in PR E's exploratory matrix; no macOS, Windows, or real-provider evidence is claimed here.

## Remaining sections

PRs B–E append their findings, fixes, RED→GREEN evidence, gates, and the final exploratory matrix below. Stage 51 is not complete until PR E records the whole-round gate and every deferral link.
