# Emend 2.11.0 PR 04 Markdown Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issue #79 by consolidating Markdown line, container, frontmatter, fence, inline-code, and table scanning behind one focused lossless scanner while preserving Selection-context and edit-validation behavior exactly.

**Architecture:** `markdown-scanner.ts` owns source offsets and lexical/structural projections. A legacy-context projection preserves the existing LF-oriented Selection blocks, while separate semantic-fence, Track Changes compatibility, payload-fence, inline-code, and table projections preserve Stage 38 edit safeguards. `selection-context.ts` retains block containment, adjacent expansion, omission markers, and budgeting; `markdown-edit-guards.ts` retains Operation intersection, payload, affected-row review-view, violation-order, and diagnostic policy.

**Tech Stack:** Strict TypeScript, Obsidian 1.11.4+ desktop APIs, Vitest 4 with existing Obsidian mocks, ESLint, esbuild/CommonJS for ES2021, and the established ignored real-Obsidian Linux/Xvfb loopback harness with Track Changes. No new dependency or Markdown parser library.

**Spec:** Approved global plan `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, PR 04 row and Global Constraints only; [Issue #79](https://github.com/chliu1990/obsidian-emend/issues/79); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `ROADMAP.md`; Stages 15, 37, 38, 49, 51, and 54–56; current Selection/edit source and tests.

## Global Constraints

- Base implementation on merged main commit `343f16ecb7c21cd6b181d61d27be1e76fd0764c1`, on branch `feature/2.11-pr04-markdown-scanner`. PRs 01–03 are merged dependencies. PR 04 intentionally precedes PR 05; do not reopen sequencing.
- Keep plugin ID `emend`, view type `emend-chat-view`, existing `emend:` command IDs, and released version metadata stable until the separate 2.11.0 release PR.
- This is behavior-preserving. No broader editing enablement, table Operations, relaxed conservative guard, changed user-visible diagnostic, automatic context expansion, controller extraction, or in-token behavior change.
- Do not bundle PR 05 controller extraction or PR 06 actionable in-token rejection. Do not modify `chat-view.ts` for this refactor.
- Preserve PR 02 maintained/captured target behavior and PR 03 shared freshness and writer contracts. Full-note Edit alone may call guarded `vault.modify`; Selection-based edits may call only native `editor.replaceRange` on captured offsets.
- Chat, Chat Selection, Web research, and Related Notes remain writer-free. Context expansion never expands occurrence resolution, Operation targets, or native replacement ranges.
- Operations remain the only model-facing edit protocol. Resolve exact original anchors atomically; reject ambiguity, overlap, out-of-target ranges, malformed structure, and stale state. Never partially apply a rejected candidate.
- Existing Edit workflows continue to emit reviewable CriticMarkup. Track Changes remains separate and is the only Apply/Reject surface: no Emend diff/Apply/Reject UI, bundling, automatic installation, or second review UI.
- Candidate-validation failure retains exactly one same-provider correction with bounded private diagnostics. Provider, abort, stale, capacity, permission, read, and write failures get none.
- Preserve the exact violation codes, operation/type/field/line details, first-violation ordering, and user-visible messages for `inline-code-range`, `fenced-code-edit`, and `table-structure-edit`.
- Preserve Stage 38 semantic fence ranges, separate Track Changes shadow ranges, exact insertion boundaries, inline-code containment rules, escaped-pipe parity, affected-row original/annotated/accepted/rejected signatures, and composed-candidate validation.
- Treat source as literal JavaScript UTF-16 text. Do not normalize CRLF/LF/lone CR, Unicode, whitespace, NFC/NFD, or malformed input. Do not add a universal CommonMark parser.
- Preserve ready-only originating-session history, same-note request serialization, schema-3 persistence, SecretStorage credentials, sanitized saves, capacity checks, abort/target/generation guards, and private raw candidates/diagnostics.
- Use focused modules and existing TypeScript style: tabs, single quotes, semicolons, trailing commas, and `async`/`await`. No second provider stack, background request, telemetry, remote code execution, or unbundled runtime dependency.
- New chat-view behavior tests are not expected. If a legacy chat-view case becomes necessary, migrate that case to the PR 01 public seam rather than extending private-prototype retrofitting.
- Update `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, and add Stage 57. Historical stage records remain unchanged. User guides need no behavioral rewrite unless an actual stale claim is found.
- Feature and refactoring PRs do not bump versions, create tags, publish releases, change workflows, or submit to the Community Directory.
- Manual verification uses only ignored `test_vault/`, synthetic notes, loopback OpenAI-compatible SSE/CORS mocks, and dummy SecretStorage credentials. Never use real accounts, paid calls, private notes, personal paths, or other vaults.
- Every task uses a fresh sequential implementer and independent task review under SDD. Require focused RED or justified already-green characterization, minimal implementation, focused tests, self-review, full `npm test`, and a commit before the next task.
- Final whole-PR review must include independent code and write/security verdicts. Submit the PR and stop at the human gate; do not merge automatically or start PR 05.

## Review Focus

1. **Selection strictening or loosening:** CRLF, lone CR, legacy backtick-info fences, closing indentation, frontmatter, and unclosed blocks must produce byte-identical Smart context. Owned by Tasks 1 and 3, with runtime coverage in Task 6.
2. **Fence and Track Changes disagreement:** semantic container fences, unclosed ranges, exact review-parser closing runs, nested shadows, and insertion boundaries must retain their distinct ranges and rejection behavior. Owned by Tasks 2 and 4.
3. **Table structure and escaped delimiters:** backslash parity, outer pipes, containers, CRLF offsets, actual `compiledText`, and all review views must remain conservative without enabling structural table edits. Owned by Tasks 2 and 5.
4. **Diagnostics and malformed text:** empty/final lines, mixed line endings, Unicode UTF-16 offsets, unmatched fences/backticks, and malformed tables must retain exact codes, fields, lines, messages, correction count, and zero-write behavior. Owned by Tasks 2, 4, 5, and 6.
5. **Writer/target isolation and scanner cost:** sharing lexical facts must not alter freshness, writer routing, Selection confinement, or turn Smart context into an expensive edit-policy scan. Owned by Tasks 3–6 and final independent review.

## Current Divergence and Exact Ownership

### Selection-context behavior that must remain authoritative for context

`src/selection-context.ts` currently owns:

- LF-only line splitting. `TextLine.end` is the `\n` offset, so CRLF line text and block ranges retain the `\r` but exclude `\n`.
- No synthetic line for empty input or after a trailing newline.
- Document-leading frontmatter when the first line’s `trim()` is `---`; a later trimmed `---` or `...` closes it. Unclosed frontmatter consumes the note without duplicate inner blocks.
- Context fence opening with zero-to-three literal spaces and a backtick/tilde run of at least three. Backtick info strings containing backticks still count as context fence openers.
- Context closing after `trim()`, with the same delimiter character and at least the opening length. This is intentionally not the stricter edit/container parser.
- Blank-line-delimited paragraphs, complete containing blocks, before-then-after whole-block expansion, source-character budgets, symmetric in-block truncation, and exact omission markers.
- No table-specific block behavior and no container-aware context fences.

The full-note short-circuit in `buildSmartSelectionContext` remains before scanning. Returned `from`, `to`, and `selectedText` always remain the original captured values.

### Edit-guard behavior that must remain authoritative for editing

`src/markdown-edit-guards.ts` currently owns:

- Strict lines for LF, CRLF, and lone CR, with `start`, `contentEnd`, `end`, and content excluding the line ending. No synthetic final line.
- Normalized blockquote/list container matching, visual indentation widths, and semantic fence openers. Backtick info strings containing backticks are not semantic fence openers.
- Semantic unclosed-fence behavior, including container termination, exact closing-content offsets, and EOF insertion rejection.
- Separate Track Changes compatibility ranges opened by a container-free line indented zero to three spaces whose first content is a backtick/tilde run, followed by `\n`. “Container-free” does not mean info-string-free: the compatibility opener accepts arbitrary trailing info text, including backticks. Shadows end only at the exact later container-free matching run with no info text, or EOF; their offsets remain distinct from semantic fence offsets.
- Inline-code matching, escaped opening runs, closing runs independent of backslash parity, multiline/container/lazy continuation boundaries, and actual block starts.
- Tables with same-container header/delimiter rows, escaped-pipe parity, absolute cell offsets, outer-pipe handling, body terminators, and fence exclusion.
- Payload-specific fence rules inside CriticMarkup wrappers, including the requirement that a closing fence line be followed by a line break inside the wrapper.
- Operation intersection/containment decisions, violation ordering, affected-row compilation, accepted/rejected views, and diagnostic production.

Frontmatter is not an edit exclusion today. The shared scanner must not start suppressing fences or tables inside frontmatter.

### Ownership after consolidation

| Concern | Shared scanner owns | Policy owner that remains separate |
| --- | --- | --- |
| Source lines and offsets | Exact UTF-16 ranges and line endings | Selection chooses legacy LF projection; diagnostics use strict lines |
| Containers | Quote/list segments, content starts, normalized matching | Edit fence/table/inline projections only |
| Frontmatter | Legacy document-leading range and next-line index | Selection block construction only |
| Context fences | Existing loose opener/closer ranges | Selection containing/adjacent block policy |
| Semantic fences | Container-aware ranges and insertion-related offsets | Edit intersection/rejection policy |
| Track Changes shadows | Exact compatibility ranges | Edit intersection/rejection policy |
| Payload fences | Wrapper-compatible closed ranges | Payload balance and diagnostic policy |
| Inline code | Complete source spans | Operation containment/insertion rules |
| Tables | Rows, delimiter ranges, cells, absolute offsets | Operation and review-view structure rules |
| Escapes/backticks/table splitting | Literal parity and delimiter facts | Payload and affected-row policies |
| Diagnostics | One-based strict-line lookup | Existing code/field/message/correction policy |

## Chosen Design and Alternatives

### Recommended: one lossless scan with explicit policy projections

Create `src/markdown-scanner.ts` with these interfaces:

```ts
export interface MarkdownRange {
	readonly start: number;
	readonly end: number;
}

/** Legacy Selection projection: LF-only splitting, with CR retained in text/ranges. */
export interface MarkdownContextLine extends MarkdownRange {
	readonly text: string;
}

export interface MarkdownContextFrontmatter extends MarkdownRange {
	readonly closed: boolean;
	readonly nextLine: number;
}

export interface MarkdownContextFence extends MarkdownRange {
	readonly closed: boolean;
	readonly openingLine: number;
	readonly nextLine: number;
}

export interface MarkdownContextScan {
	readonly source: string;
	readonly contextLines: readonly MarkdownContextLine[];
	readonly contextFrontmatter?: MarkdownContextFrontmatter;
	readonly contextFences: readonly MarkdownContextFence[];
}

export type MarkdownLineEnding = '' | '\n' | '\r' | '\r\n';

export type MarkdownContainerSegment =
	| { readonly type: 'quote' }
	| { readonly type: 'indent'; readonly width: number };

export interface MarkdownContainerOpening {
	readonly contentStart: number;
	readonly segments: readonly MarkdownContainerSegment[];
}

export interface MarkdownLine extends MarkdownRange {
	readonly contentEnd: number;
	readonly text: string;
	readonly ending: MarkdownLineEnding;
	readonly container: MarkdownContainerOpening;
}

export interface MarkdownFenceRange extends MarkdownRange {
	readonly closed: boolean;
	readonly containerEnded: boolean;
	readonly openingStart: number;
	readonly closingContentEnd?: number;
}

export interface MarkdownReviewFenceRange extends MarkdownRange {
	readonly closed: boolean;
	readonly openingStart: number;
}

/** An unclosed payload opener extends to EOF and must reject payload validation. */
export interface MarkdownPayloadFenceRange extends MarkdownRange {
	readonly closed: boolean;
}

export interface MarkdownScan {
	readonly source: string;
	readonly lines: readonly MarkdownLine[];
	readonly semanticFences: readonly MarkdownFenceRange[];
	readonly reviewFenceRanges: readonly MarkdownReviewFenceRange[];
	readonly payloadFenceRanges: readonly MarkdownPayloadFenceRange[];
}

export interface MarkdownTableRow extends MarkdownRange {
	readonly contentStart: number;
	readonly contentEnd: number;
	readonly cells: readonly MarkdownRange[];
}

export interface MarkdownTable extends MarkdownRange {
	readonly header: MarkdownTableRow;
	readonly delimiter: MarkdownRange;
	readonly body: readonly MarkdownTableRow[];
}

export interface MarkdownEditStructure {
	readonly inlineCodeSpans: readonly MarkdownRange[];
	readonly tables: readonly MarkdownTable[];
}

export function scanMarkdownContext(source: string): MarkdownContextScan;
export function scanMarkdown(source: string): MarkdownScan;
export function scanMarkdownEditStructure(scan: MarkdownScan): MarkdownEditStructure;
export function markdownLineNumberAt(lines: readonly MarkdownLine[], offset: number): number;
export function splitMarkdownTableRow(text: string, contentStart?: number): readonly MarkdownRange[];
export function isMarkdownBlockStart(text: string): boolean;
export function isMarkdownEscaped(text: string, index: number): boolean;
export function markdownBacktickRunEnd(text: string, start: number): number;
```

Key decisions:

- `scanMarkdownContext` computes only legacy LF-oriented context lines, frontmatter, and context fences. Selection calls this entry point after the existing full-note short-circuit and never invokes either edit entry point.
- `scanMarkdown` computes only strict lines, containers, semantic fences, Track Changes review shadows, and payload fences. It does not compute the Selection projection, inline code, or tables.
- `scanMarkdownEditStructure` accepts the `MarkdownScan` returned by `scanMarkdown`, not a `MarkdownContextScan`, and adds inline-code/table facts without another strict-line scan.
- `findMarkdownEditViolation` calls `scanMarkdown` and `scanMarkdownEditStructure` once per source. `findPayloadStructureViolation` calls only `scanMarkdown` for each wrapped payload.
- Both entry points share private lexical primitives inside `markdown-scanner.ts`. Neither policy module reimplements line, container, frontmatter, or fence parsing.
- `selection-context.ts` consumes only `MarkdownContextScan` and continues constructing paragraphs and making every expansion/budget decision itself.
- `markdown-edit-guards.ts` consumes only `MarkdownScan` and `MarkdownEditStructure`. Its exported API and `MarkdownEditViolation` remain unchanged.
- Table-row signature generation stays in `markdown-edit-guards.ts`, but uses `splitMarkdownTableRow`, `isMarkdownBlockStart`, and `isMarkdownEscaped` rather than duplicate delimiter scanners.
- No global cache, mutable scan state, Obsidian import, writer import, or Operation import enters the scanner.

The two top-level entry points add a small amount of API surface and would perform separate traversals if one caller ever needed both projections. No current caller needs both. That cost is preferable to making every Selection request compute edit-only structure or using a mode-flag API whose unsafe combinations are easy to misuse. Shared private primitives keep one implementation of each lexical rule.

`payloadFenceRanges` is not a closed-only list. No opener produces `[]`. Every recognized opener produces a range with `closed: false` until a valid closer is found. A closed range ends at `closingLine.end`, including its line ending; an unclosed range ends at `source.length`. The scanner retains the current sequential opener search and skips to a closed fence’s closing line so openers inside that fenced payload are not scanned again.

Lossless invariants:

- Strict lines satisfy `source.slice(line.start, line.contentEnd) === line.text` and `source.slice(line.contentEnd, line.end) === line.ending`.
- Strict lines partition a nonempty source exactly; the next line starts at the previous `end`.
- Context lines preserve the old LF-only slices exactly, including `\r` in CRLF text.
- Empty input and a trailing line ending create no synthetic line.
- All offsets are UTF-16 code-unit offsets. Unicode remains literal and unnormalized.
- Unclosed/malformed constructs remain explicit unclosed or unrecognized facts; scanning itself does not throw, repair, or normalize them.

Complexity expectations:

- `scanMarkdownContext`: O(source length) time and O(context-line/frontmatter/context-fence count) additional space, with no strict-line, container, semantic/review/payload fence, inline-code, or table work.
- `scanMarkdown`: O(source length) time and O(strict-line/container/fence count) additional space, with no context, inline-code, or table projection work.
- `scanMarkdownEditStructure`: O(source length + backtick runs + table cells), using the input scan’s strict lines, line-start maps, and monotonically advancing sorted-range cursors.
- Selection containment/expansion remains linear in context blocks. Operation checks may retain their current operation-by-range cost, while source-line diagnostics use indexed strict lines.
- Do not add a performance benchmark claim unless an actual benchmark is run and recorded.

### Alternative A: make `markdown-edit-guards.ts` authoritative and adapt Selection to it

This would minimize new modules, but Selection would inherit or depend on edit-specific semantic fences, Track Changes shadows, inline code, and tables. Adapters would still need to recover LF-only lines and loose context fences from an unsuitable representation. It increases coupling and accidental Selection strictening, so reject it.

### Alternative B: make `selection-context.ts` authoritative and strengthen it for editing

The loose context scanner lacks CR-only handling, containers, semantic info-string rules, Track Changes shadows, inline-code boundaries, and table cells. Adding all of them would turn a small context module into an edit-policy module and invite lowest-common-denominator decisions. Reject it.

### Alternative C: adapters around one existing scanner with policy flags throughout

A single scanner function with many boolean modes would avoid some duplication but make every branch’s authority unclear and allow future callers to select an unsafe mode accidentally. Named result projections make misuse visible and keep policy decisions outside the scanner. Reject the flag-heavy version.

## Explicit Non-Goals

- No table row, column, delimiter-row, or cross-cell Operations and no speculative future-table API.
- No general list/blockquote editing enablement, general fenced-code editing, Mermaid exception, or universal CommonMark compatibility.
- No automatic context expansion, changed Smart/Symmetric/full-note context setting, or changed edit target.
- No PR 05 controller extraction, `chat-view.ts` decomposition, or PR 06 in-token diagnostic change.
- No change to Operations parsing, replacement minimization, CriticMarkup parsing, composed Selection validation, freshness, writers, permissions, or correction count.
- No provider, persistence, capacity, settings, UI, workflow, dependency, version, tag, release, or Community Directory work.
- No committed runtime harness, generated bundle, evidence, vault content, credentials, or local settings.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-11-23-emend-2-11-pr04-markdown-scanner.md` | Create | This focused plan. |
| `src/markdown-scanner.ts` | Create | Lossless lines and named lexical/structural projections only. |
| `src/selection-context.ts` | Modify | Consume context projections; retain expansion/budget policy. |
| `src/markdown-edit-guards.ts` | Modify | Consume shared projections; retain violation and payload policy. |
| `tests/markdown-scanner.test.ts` | Create | Direct lossless range/projection contract tests. |
| `tests/selection-context.test.ts` | Modify | Characterize exact legacy Smart-context output before and after migration. |
| `tests/markdown-edit-guards.test.ts` | Modify | Characterize structural ranges, malformed input, and violations. |
| `tests/operation-edit-strategy.test.ts` | Modify | Pin exact diagnostics, review views, target confinement, and correction behavior. |
| `tests/replacement-diff.test.ts` | Regression only | Preserve backtick-aware compilation and Unicode reconstruction. |
| `tests/critic-markup.test.ts` | Regression only | Preserve original-token and reject-view behavior. |
| `tests/selection-editor.test.ts` | Regression only | Preserve Smart prompts, absolute guards, freshness, and native replacement. |
| `test_vault/emend-selection-chat-verify/verify.mjs` | Ignored local only | Add `--markdown-scanner` using the PR 03 harness baseline. |
| `test_vault/emend-selection-chat-verify/mock-provider.mjs` | Ignored local only | Add deterministic structural/context Operations. |
| `devel_docs/57-markdown-scanner.md` | Create | Record design, characterization, actual evidence, review, and limitations. |
| `AGENTS.md` | Modify | Record scanner ownership and separate context/edit policies. |
| `IMPLEMENTATION_PLAN.md` | Modify | Update architecture contract and add Stage 57. |
| `ROADMAP.md` | Modify | Add Stage 57 and remove only resolved #79 deferral. |
| `docs/guides/chat-and-context.md`, `docs/guides/editing-and-review.md` | Review; normally unchanged | No user behavior changes; edit only if a factual stale claim is discovered. |

No changes are planned for `chat-view.ts`, `selection-editor.ts`, `operation-edit-strategy.ts`, `replacement-diff.ts`, `critic-markup.ts`, `edit-freshness.ts`, `note-writer.ts`, `edit-target.ts`, or `main.ts`.

## Characterization-First Matrix

Tasks 1–2 pin these behaviors against the public existing functions before scanner code exists. Existing tests remain; add only missing cases and do not rewrite expectations to match a new scanner.

| Input class | Selection-context expectation | Edit-guard expectation |
| --- | --- | --- |
| LF paragraphs and adjacent blocks | Existing complete/containing/adjacent/budget output unchanged | Existing source ranges unchanged |
| CRLF | Context line/block ranges retain `\r`, exclude `\n`, and preserve exact emitted context | Strict content excludes CRLF; absolute offsets and one-based lines remain exact |
| Lone CR/mixed endings | Lone CR remains literal within the legacy LF projection | Lone CR is a strict line ending; mixed endings retain exact lines |
| Empty/final lines | No synthetic blocks; existing containing-selection error remains where currently reachable | No synthetic line; EOF/trailing-newline diagnostics retain current line numbers |
| Frontmatter | Trimmed document-leading opener and `---`/`...` closer; unclosed range consumes note | No new frontmatter exclusion for semantic fences/tables |
| Context fence divergence | Backtick info containing backticks and trimmed closing indentation retain current context blocks | Semantic scanner retains its stricter opener/closer rules |
| Containers | No new container-aware context expansion | Existing normalized quote/list fence/table/inline behavior |
| Unclosed fences | Context range extends to EOF without inner duplicate blocks | Semantic/container/EOF and review-shadow rejection remains exact |
| Track Changes shadows | Not used for context | Exact container-free compatibility openers, exact bare closing runs, range offsets, nesting, and same-opening exemption |
| Payload fences | Not used for context | Openers remain distinguishable from unclosed ranges; final-wrapper-line closers reject, newline-terminated closers may pass, and wrapper backtick pairing remains unchanged |
| Inline code | Not used for context | Complete-span containment, multiline/boundary, escaped opener, and closing-run behavior |
| Tables/escaped pipes | No new table-specific context blocks | Same-container tables, absolute cells, odd/even backslash parity, outer pipes, and terminators |
| Unicode | Exact selected offsets/text and literal context | UTF-16 offsets, CJK/emoji/decomposed text preserved without normalization |
| Malformed input | Existing unclosed-block behavior | No repair; existing unmatched-backtick, malformed-table, and unclosed-fence outcomes |
| Diagnostics | No diagnostics from context expansion | Same first violation, code, operation/type/field/line, exact message, one correction, zero writes on repeated invalid candidates |
| Writers/targets | Context never changes captured Selection | Full-note/native writer routing and PR 03 freshness remain unchanged |

---

### Task 1: Characterize Legacy Selection-Context Boundaries

**Files:** Modify `tests/selection-context.test.ts`; regression `tests/selection-editor.test.ts`.

**Interfaces:** Keeps `buildSmartSelectionContext(fullText, from, to, maxCharacters)` and `SelectionContext` unchanged. All new tests are expected to pass before migration.

- [ ] **Step 1: Add already-green characterization tests**

Add exact-output cases that force structural scanning by making the note exceed `maxCharacters`:

1. CRLF frontmatter: verify the complete context block includes the closing line’s `\r`, followed by the existing `\n[...]` suffix. Set the budget to the actual legacy block length so the case does not accidentally enter bounded truncation.
2. CRLF multiline paragraph and fenced block: assert exact `contextText`, selected offsets, and selected text.
3. Lone-CR and mixed CR/LF/CRLF fixtures: assert the current LF-only context result byte-for-byte.
4. A context fence whose backtick info string contains backticks, proving it remains a context fence even though it is not a semantic edit fence.
5. A closing fence indented beyond the semantic zero-to-three-space rule but accepted by the current `trim()` context closer.
6. Blockquote/list-prefixed fence-like lines, proving no new container-aware context blocks appear.
7. Closed and unclosed frontmatter with indented/trimmed `---` and `...` closers; unclosed frontmatter must not produce duplicate inner blocks.
8. Closed and unclosed fences with internal blank lines and trailing document newlines.
9. Empty/final-line boundaries and Unicode/CJK/emoji/decomposed text with exact UTF-16 `from`/`to`.
10. A table fixture proving no new table-specific expansion policy appears beyond the existing paragraph behavior.

Use explicit expected strings, not snapshots generated from the implementation. Keep existing short-note, containing-block, adjacent-budget, oversized-selection, and omission-marker cases unchanged.

- [ ] **Step 2: Run the characterizations before production changes**

```bash
npx vitest run tests/selection-context.test.ts tests/selection-editor.test.ts
```

Expected: PASS on unchanged production. These are already-green characterizations because they pin existing behavior; do not manufacture a failure or alter behavior to create RED. If a test fails, determine whether the fixture or the existing implementation is wrong and report any actual defect before proceeding.

- [ ] **Step 3: Self-review and full suite**

```bash
npm test
git diff --check
```

Expected: all tests pass. Confirm every new divergence has an exact assertion and none depends on the future scanner.

- [ ] **Step 4: Commit and independent task review**

```bash
git add tests/selection-context.test.ts
git commit -m "test: characterize selection Markdown boundaries"
```

The fresh reviewer checks that the tests describe current behavior rather than the proposed design.

---

### Task 2: Characterize Edit-Guard Ranges, Diagnostics, and Review Views

**Files:** Modify `tests/markdown-edit-guards.test.ts`, `tests/operation-edit-strategy.test.ts`; regression `tests/replacement-diff.test.ts`, `tests/critic-markup.test.ts`.

**Interfaces:** Keeps both guard functions, `GuardedMarkdownOperation`, `MarkdownEditViolation`, and all strategy diagnostics unchanged. New characterizations are expected to pass before migration.

- [ ] **Step 1: Add missing already-green structural characterizations**

Extend existing comprehensive suites rather than duplicating them:

1. Lone-CR and mixed CR/LF/CRLF documents with exact absolute Operation ranges and one-based insertion/target diagnostic lines.
2. Empty input where directly callable, trailing-newline EOF insertion, and no-synthetic-final-line cases.
3. Fence-like and table-like content inside frontmatter, pinning that no new edit exclusion is introduced.
4. Unicode before/inside inline code and table cells, including emoji, CJK, and NFC/NFD-distinct literal text.
5. Additional odd/even backslash-parity pipes and outer-pipe/table-container combinations not already covered.
6. Unclosed/mismatched/short/longer fence closers, malformed delimiter rows, and unmatched backtick runs.
7. Payload fences in wrappers, especially closers sharing the wrapper’s last line versus followed by a payload newline.
8. Track Changes shadow offsets and same-opening exemption cases not already directly asserted.

- [ ] **Step 2: Pin exact public diagnostics and correction boundaries**

Through `operationEditStrategy.prepareEdit`, assert complete error objects and exact messages for `inline-code-range` target/insertion, semantic/review `fenced-code-edit`, payload `fenced-code-edit` with text/replacement/comment fields, and `table-structure-edit` target/payload variants.

Assert first violation in request order, existing range-isolation precedence, Selection absolute full-note lines, no source/replacement/comment sentinels in messages, and actual `compiledText` affected-row rejection. Retain coordinator tests proving structural failure causes exactly two requests when second candidate is invalid, no writer/freshness read, and no partial write. Keep complete-span and safe-cell accept/reject reconstruction tests.

- [ ] **Step 3: Run the characterizations before production changes**

```bash
npx vitest run tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/replacement-diff.test.ts tests/critic-markup.test.ts
```

Expected: PASS on unchanged production. Do not change an assertion merely because it documents inconvenient legacy behavior.

- [ ] **Step 4: Self-review and full suite**

```bash
npm test
git diff --check
```

Check matrix against Stage 38/51, especially compatibility shadows, payload wrappers, affected-row review views, and diagnostics.

- [ ] **Step 5: Commit and independent task review**

```bash
git add tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts
git commit -m "test: characterize Markdown edit scanner boundaries"
```

---

### Task 3: Introduce the Lossless Scanner and Migrate Selection Context

**Files:** Create `src/markdown-scanner.ts`, `tests/markdown-scanner.test.ts`; modify `src/selection-context.ts`; regression `tests/selection-context.test.ts`, `tests/selection-editor.test.ts`.

**Interfaces:** Produces `MarkdownRange`, `MarkdownContextLine`, `MarkdownContextFrontmatter`, `MarkdownContextFence`, `MarkdownContextScan`, and `scanMarkdownContext` exactly as defined above. It does not yet define or implement strict edit lines, containers, semantic/review/payload fences, inline code, tables, `MarkdownScan`, `scanMarkdown`, or `scanMarkdownEditStructure`.

- [ ] **Step 1: Write failing context scanner contract tests**

Test only `scanMarkdownContext`:

1. `''`, `'alpha'`, `'alpha\n'`, `'\n'`, CRLF, lone CR, and mixed endings. Assert exact legacy context-line arrays and source slices, including retained `\r` and no synthetic final line.
2. Closed, unclosed, and trimmed frontmatter with exact ranges and `nextLine`.
3. Context fence openers/closers, backtick-info divergence, trimmed closing indentation, internal blanks, and unclosed EOF.
4. Unicode before delimiters, proving offsets remain UTF-16 code units.

Do not add semantic-fence, Track Changes-shadow, container, payload, inline-code, or table tests in this task.

- [ ] **Step 2: Confirm genuine RED**

```bash
npx vitest run tests/markdown-scanner.test.ts
```

Expected: FAIL because `src/markdown-scanner.ts` and `scanMarkdownContext` do not exist.

- [ ] **Step 3: Implement only the shared context projection**

Move existing Selection line/frontmatter/context-fence algorithms into `scanMarkdownContext`, using private primitives that Task 4 can extend without duplicating lexical rules. Do not implement any edit-only projection in this task.

- [ ] **Step 4: Migrate only Selection block construction**

Replace `getLines`, `getFenceOpening`, and `isFenceClosing` with one `scanMarkdownContext(fullText)` call after the existing full-note short-circuit. Build blocks from `contextLines`, `contextFrontmatter`, `contextFences`.

Keep containment, adjacent expansion, bounded ranges, omission markers, selected offsets/text, and budget arithmetic unchanged. Selection must not call `scanMarkdown` or `scanMarkdownEditStructure`.

- [ ] **Step 5: Run focused verification and self-review**

```bash
npx vitest run tests/markdown-scanner.test.ts tests/selection-context.test.ts tests/selection-editor.test.ts
npx tsc -noEmit -skipLibCheck
npx eslint src/markdown-scanner.ts src/selection-context.ts tests/markdown-scanner.test.ts tests/selection-context.test.ts
```

Expected: all pass, especially every Task 1 exact-output case. Self-review that Selection performs no edit-only scan and no expansion decision moved into the scanner.

- [ ] **Step 6: Run full suite and commit**

```bash
npm test
git diff --check
git add src/markdown-scanner.ts src/selection-context.ts tests/markdown-scanner.test.ts tests/selection-context.test.ts
git commit -m "refactor: share Markdown lexical and context scanning"
```

Obtain independent task review before Task 4.

---

### Task 4: Migrate Semantic, Review, Payload, and Inline-Code Guards

**Files:** Modify `src/markdown-scanner.ts`, `src/markdown-edit-guards.ts`, `tests/markdown-scanner.test.ts`; regression `tests/markdown-edit-guards.test.ts`, `tests/operation-edit-strategy.test.ts`, `tests/replacement-diff.test.ts`, `tests/critic-markup.test.ts`.

**Interfaces:** Adds strict line/container types, `MarkdownFenceRange`, `MarkdownReviewFenceRange`, `MarkdownPayloadFenceRange`, `MarkdownScan`, `scanMarkdown`, `MarkdownEditStructure` with `inlineCodeSpans`, and `scanMarkdownEditStructure(scan: MarkdownScan)`. Adds `markdownLineNumberAt`, `isMarkdownBlockStart`, `isMarkdownEscaped`, and `markdownBacktickRunEnd`. Guard exports remain unchanged.

- [ ] **Step 1: Add failing strict, fence, payload, inline, and lookup contracts**

Add direct tests for:

1. Strict LF/CRLF/lone-CR/mixed lines, exact endings, content offsets, next-line starts, and source reconstruction.
2. Container segments and normalized matching for quotes, lists, nesting, tabs, visual widths, and malformed prefixes.
3. Semantic fence ranges, container termination, opening/closing offsets, and unclosed blocks.
4. Track Changes shadow ranges and exact closing-run behavior.
5. Payload distinctions: no opener returns `[]`; EOF-unclosed returns `closed: false` and `end === source.length`; a closer sharing the wrapper’s final line remains unclosed and produces the existing `fenced-code-edit`; the same closer followed by `\n` inside the wrapper returns `closed: true` and `end` at the strict closing line’s `end`; multiple sequential fences preserve pairing and any later unclosed opener rejects.
6. Complete/adjacent/multiline inline spans, equal/unequal closing runs, escaped openers versus closing-run parity, block/HTML/lazy-continuation boundaries, semantic-fence exclusion, and unmatched runs.
7. `markdownLineNumberAt` at line starts, content ends, between `\r` and `\n`, after terminators, EOF, and empty input.

These tests fail because the strict scan, edit projection, and lookup exports do not exist. Retain all Task 2 public guard tests as the migration oracle, including payload insertion/replacement/comment fields, exact messages, one correction, and zero writes after repeated invalid candidates.

- [ ] **Step 2: Confirm genuine RED**

```bash
npx vitest run tests/markdown-scanner.test.ts
```

Expected: FAIL because the strict scan, edit projection, and lookup exports do not exist.

- [ ] **Step 3: Implement strict scanning and the inline edit projection**

Extend the shared module with `scanMarkdown`, reusing private lexical primitives rather than duplicating Task 3’s parser. Implement strict lines/containers, semantic/review/payload fences, then add `scanMarkdownEditStructure(scan)` with the existing inline matcher and block-start distinctions.

`scanMarkdown` must not invoke `scanMarkdownContext`, and `scanMarkdownEditStructure` must accept `MarkdownScan`, not `MarkdownContextScan`. Implement `markdownLineNumberAt` with the same one-based semantics as current `sourceLineAt`, including a trailing line ending producing the following line number at EOF.

- [ ] **Step 4: Consume shared facts in guards**

In `findMarkdownEditViolation`, use `scanMarkdown` plus `scanMarkdownEditStructure`. Keep all Operation checks and their order unchanged.

In `isPayloadStructureBalanced`, first reject when `scan.payloadFenceRanges.some(fence => !fence.closed)`. Only after every opener is closed may `hasPairedBacktickRuns` receive those ranges for exclusion from backtick pairing. A matching delimiter on the wrapper’s final line has `candidate.end === candidate.contentEnd`, so it does not close the payload fence and must reject. No opener proceeds to the existing backtick-pairing rule rather than automatically passing or failing. Keep `payloadStart`, wrapper construction, and pairing semantics in `markdown-edit-guards.ts`, and replace duplicated escape/backtick-run helpers with shared literal helpers.

Delete old `scanLines`, `scanFences`, `scanTrackChangesFenceRanges`, `scanInlineCode`, and duplicate fence/container functions only after consumers migrate. Do not change violation messages or correction flow.

- [ ] **Step 5: Run focused and consumer verification**

```bash
npx vitest run tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/replacement-diff.test.ts tests/critic-markup.test.ts tests/selection-context.test.ts tests/selection-editor.test.ts
npx tsc -noEmit -skipLibCheck
npx eslint src/markdown-scanner.ts src/markdown-edit-guards.ts tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts
```

Expected: all pass with byte-identical diagnostics and compiled markup.

- [ ] **Step 6: Self-review, full suite, and commit**

Check semantic-versus-review range identity, same-opening exemptions, EOF insertion, payload closer handling, and no repeated line scan.

```bash
npm test
git diff --check
git add src/markdown-scanner.ts src/markdown-edit-guards.ts tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts
git commit -m "refactor: share Markdown fence and inline-code scanning"
```

Obtain independent task review before Task 5.

---

### Task 5: Migrate Tables and Finish Guard Scanner Deduplication

**Files:** Modify `src/markdown-scanner.ts`, `src/markdown-edit-guards.ts`, `tests/markdown-scanner.test.ts`; regression `tests/markdown-edit-guards.test.ts`, `tests/operation-edit-strategy.test.ts`, `tests/selection-context.test.ts`, `tests/selection-editor.test.ts`.

**Interfaces:** Extends `MarkdownEditStructure` with `tables`. Adds `splitMarkdownTableRow`. Existing guard and strategy APIs remain unchanged.

- [ ] **Step 1: Add failing table projection contracts**

Directly assert table ranges and absolute cells for:

1. Outer/no-outer-pipe tables, zero-to-three-space indentation, trailing spaces/tabs, CRLF.
2. Escaped pipes with odd/even backslash parity and literal Unicode content.
3. Quote/list/nested containers and absolute offsets.
4. Header/delimiter container mismatches, malformed delimiters, prose pipes without adjacent delimiter.
5. Body termination at blanks, fences, headings, blockquotes, lists, thematic breaks.
6. Table-like content inside semantic fences and frontmatter, preserving current inclusion/exclusion behavior.

Tests fail because `tables` and `splitMarkdownTableRow` are absent.

- [ ] **Step 2: Confirm genuine RED**

```bash
npx vitest run tests/markdown-scanner.test.ts
```

Expected: FAIL on missing table projection.

- [ ] **Step 3: Move table scanning without moving violation policy**

Move same-container recognition, delimiter checks, body scanning, escaped-pipe splitting, absolute row/cell construction into `scanMarkdownEditStructure`. Reuse strict lines and semantic fences. `scanMarkdownEditStructure` continues to consume the same `MarkdownScan`; Task 5 only extends its returned `MarkdownEditStructure` with `tables` and adds `splitMarkdownTableRow`. Keep `preservesTableRowStructure`, actual `compiledText`, descending Operation composition, accepted/rejected views, payload-character rejection, `tableRowViewSignature`, `fallbackCompiledText` in `markdown-edit-guards.ts`. Have signature generation use `splitMarkdownTableRow` and shared block-start/escape helpers.

- [ ] **Step 4: Delete duplicate scanners and run focused verification**

Remove old local table scanner, line duplication, remaining low-level helpers now owned by `markdown-scanner.ts`. Do not alter `MarkdownEditViolation`, Operation iteration, or table permissions.

```bash
npx vitest run tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/replacement-diff.test.ts tests/critic-markup.test.ts tests/selection-context.test.ts tests/selection-editor.test.ts
npx tsc -noEmit -skipLibCheck
npx eslint src/markdown-scanner.ts src/markdown-edit-guards.ts tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts
```

Expected: all pass. Confirm no new table Operation accepted and no safe single-cell/escaped-pipe case becomes rejected.

- [ ] **Step 5: Audit final module boundary**

Search both policy modules for retired scanner functions and inspect imports: `selection-context.ts` calls only `scanMarkdownContext` and contains no line/frontmatter/fence parser; `markdown-edit-guards.ts` calls only `scanMarkdown` and, where needed, `scanMarkdownEditStructure`, never `scanMarkdownContext`; `scanMarkdownEditStructure` consumes `MarkdownScan`, not `MarkdownContextScan`; payload scanning preserves no-opener, unclosed-opener, final-wrapper-line closer, and newline-terminated closer distinctions; `markdown-scanner.ts` contains the only lexical implementations and imports no Selection policy, `EditOperation`, guards, Obsidian, writers, or providers; no Selection request performs strict/edit-only scanning and no edit validation performs legacy-context scanning; `replacement-diff.ts`, `critic-markup.ts`, freshness, target, controller, and writer files remain unchanged.

- [ ] **Step 6: Run full suite and commit**

```bash
npm test
git diff --check
git add src/markdown-scanner.ts src/markdown-edit-guards.ts tests/markdown-scanner.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts
git commit -m "refactor: share Markdown table scanning"
```

Obtain independent task review before runtime evidence work.

---

### Task 6: Real-Obsidian Structural, Context, Writer, and Review Evidence

**Files:** Ignored local `test_vault/emend-selection-chat-verify/verify.mjs`, `mock-provider.mjs`; create `devel_docs/57-markdown-scanner.md`.

**Interfaces:** No production interface changes. Adds ignored `--markdown-scanner` harness group and actual Stage 57 code-head evidence.

- [ ] **Step 1: Provision PR 03 harness and preserve failure propagation**

Copy/provision ignored harness from `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr03-edit-freshness/test_vault/emend-selection-chat-verify/`. Use current `verify.mjs`, `mock-provider.mjs`, `model-controls.mjs`, including root/loaded bundle hashing and final `process.exitCode = exitCode`. Do not start from older structural-only harness.

Retain inherited `--edit-freshness`, `--edit-target-flow`, `--stabilization`, `--sessions` groups. Add deterministic scanner scenarios to mock and separate `--markdown-scanner` group. Before final runs, perform one harness-only negative control: force synthetic assertion failure, confirm command exits nonzero and summary records failure, then restore it. Do not describe as product failure.

- [ ] **Step 2: Implement focused real-Obsidian scenarios before execution**

Add ten synthetic scenarios with exact request, note-byte, writer, diagnostic assertions:

1. **Closed frontmatter Smart context and native undo:** over-budget LF note selects frontmatter text; assert exact complete frontmatter `Context:` block, original Selection offsets, one native replacement, zero guarded vault writes, exact annotated bytes, native undo/redo.
2. **Unclosed frontmatter/fence context:** assert unclosed blocks extend to EOF without duplicate inner content, internal blank lines intact, omission markers exact, and no-op or safe Operation performs no unauthorized write.
3. **Legacy multiline context fence, without an edit candidate:** use a top-level multiline block whose opener consists of three backticks, the info text `alpha`, and three additional backticks, followed by body text and a closing run. Assert Smart context retains the complete legacy context fence. Return `operations: []`, pinning context and zero writes without claiming an inline-code outcome. Record that this opener also creates a Track Changes compatibility shadow because info text is accepted by that projection.
4. **Inline-code guard outside semantic/review fences:** use the existing distinction fixture `Before ```alpha``` followed by prose\nNext prose`. The prefix prevents a container-free review opener, the text is not a semantic fence opener, and the triple-backtick pair remains inline code. A content-only `alpha` edit must produce `inline-code-range`, not `fenced-code-edit`, with the exact existing message, two invalid requests, and zero writes. Assert its exact bounded Smart context separately from scenario 3.
5. **Container semantic fences:** quote/list fixtures reject inside-fence and container-following prose exactly as currently classified; Selection prompt must not gain new container-aware context expansion.
6. **Track Changes shadow and exact closer:** list-created shadow rejects following prose with two calls and zero writes; separate top-level exact-close control remains editable with exact accept/reject bytes.
7. **Safe table cell, escaped pipe, Unicode Full-note edit:** one guarded `vault.modify`, zero native replacements, exact CriticMarkup, actual Track Changes accept/reject reconstruction preserving escaped pipes and Unicode.
8. **Safe table Selection edit:** only native replacement at captured offsets, outside-Selection bytes unchanged, actual native undo/redo.
9. **Unsafe table and malformed fence/payload candidates:** cross-cell/backslash-parity/unclosed-fence or unbalanced-payload cases retain exact diagnostics, exactly one correction, zero writes.
10. **Selection confinement and CRLF control:** outside-Selection candidates fail without target expansion; CRLF disk/host-normalized-editor case fails freshness closed and preserves every raw CRLF byte. Do not claim real CRLF success.

Instrument both writers on all relevant notes. Inspect actual request bodies/correction diagnostics, saved-chat privacy, exact raw files. Record actual installed Track Changes version and use real review commands for accept/reject.

- [ ] **Step 3: Build and run all required groups**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Expected: all exercised scenarios pass; every summary records actual head, equal root/loaded `main.js` SHA-256 values, `loadedBundleMatchedRoot: true`. Request logs contain no authorization headers or dummy credential. Preserve evidence only under ignored paths. If production discrepancy appears, stop and return to owning task with failing unit characterization; do not fix behavior in evidence task.

- [ ] **Step 4: Create Stage 57 from actual code-head results**

Record base/branch/issue #79 scope/exclusions/design/alternatives; exact projection ownership and lossless/UTF-16/line-ending rules; characterization-first and genuine RED; actual focused/full test/gate results available at this head; real scenario matrix, exact bytes/writers/undo/review results, bundle identity, harness negative control; environment, Obsidian/Track Changes version, theme, CDP input, provider, all limitations; explicit no universal parser/new table Operation/controller/writer/freshness change.

Do not invent counts or claim unexercised environments. Mark #79 addressed by branch and intended for closure on merge, not manually closed before merge.

- [ ] **Step 5: Self-review, full suite, and commit stage record**

```bash
npm test
git diff --check
git status --short
git add devel_docs/57-markdown-scanner.md
git commit -m "docs: record shared Markdown scanner evidence"
```

Confirm ignored harness/evidence untracked and no production change needed. Obtain independent factual review of evidence record.

---

### Task 7: Update Canonical Scanner Ownership and Issue Status

**Files:** Modify `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`; include `devel_docs/57-markdown-scanner.md` and focused plan; review only unless stale `docs/guides/chat-and-context.md`, `docs/guides/editing-and-review.md`.

**Interfaces:** Documentation only; no runtime or test contract changes.

- [ ] **Step 1: Update durable architecture ownership**

In `AGENTS.md`, add `markdown-scanner.ts` to request-flow module map; state it owns lossless lines/named lexical projections only; state Selection expansion and edit-violation policies remain separate; preserve exact Stage 38 conservative guards, Track Changes shadows, diagnostic, target, freshness, writer invariants.

In `IMPLEMENTATION_PLAN.md`, describe shared scanner and separate policy modules under context/edit boundaries without implying user behavior changed. Add Stage 57, `Shared Markdown lexical scanning`, to status paragraph and numbered index. Retain Stages 54–56 and writer/target/freshness language.

In `ROADMAP.md`, add shared Markdown scanning to recently shipped architecture work with Stage 57 link. Remove only completed #79 deferral. Leave #76, #88, #91, unrelated deferrals unchanged. Do not modify historical Stage 15/37/38/49/51/54/55/56 records.

- [ ] **Step 2: Review user guides and issue boundary**

Confirm public guides accurately describe Smart context, table/fence restrictions, review behavior. No user-guide change required merely for internal module ownership. If stale factual statement found, make smallest correction and record in Stage 57. Plan PR body with `Resolves #79`. Leave issue open until PR actually merges; do not close #76, #88, unrelated issues.

- [ ] **Step 3: Run documentation and repository checks**

Run local relative-link/anchor audit over every changed/new document. `package.json` has no dedicated audit script, so use local one-off resolver or manually inspect every changed link/heading anchor and record method/count.

```bash
npm test
git diff --check
git status --short
```

Expected: tests pass, links/anchors resolve, no historical stage/generated/vault file changed.

- [ ] **Step 4: Self-review and commit**

Confirm docs distinguish code-head evidence from later exact-documentation-head final gate.

```bash
git add AGENTS.md IMPLEMENTATION_PLAN.md ROADMAP.md devel_docs/57-markdown-scanner.md docs/superpowers/plans/2026-11-23-emend-2-11-pr04-markdown-scanner.md
git commit -m "docs: record Markdown scanner ownership"
```

If user guide actually changed, stage it explicitly in same commit.

---

### Task 8: Exact-Head Gates, Independent Code/Write-Security Review, and PR Submission

**Files:** Review complete base-to-head diff. Only review-driven fixes and corresponding evidence updates may add commits; do not create empty final commit.

- [ ] **Step 1: Run final focused scanner and consumer audit**

```bash
npx vitest run tests/markdown-scanner.test.ts tests/selection-context.test.ts tests/markdown-edit-guards.test.ts tests/operation-edit-strategy.test.ts tests/replacement-diff.test.ts tests/critic-markup.test.ts tests/selection-editor.test.ts
npx tsc -noEmit -skipLibCheck
git diff --check
```

Audit all Task 1–2 characterizations remain unchanged/pass; no policy module contains retired duplicate scanner; Selection calls only `scanMarkdownContext` and never performs strict/edit-only scanning; edit guards call only `scanMarkdown` and `scanMarkdownEditStructure`, never legacy-context scanning; `scanMarkdownEditStructure` consumes `MarkdownScan`, not `MarkdownContextScan`; payload no-opener/unclosed/final-wrapper-line/newline-terminated distinctions remain explicit; diagnostics/Operation ordering unchanged; no writer, freshness, target, controller, provider, persistence, dependency, version, workflow file changed.

- [ ] **Step 2: Run full local gate on exact submitted head**

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

All commands must pass. After any review fix, rerun focused tests then complete gate before commit.

- [ ] **Step 3: Repeat real-Obsidian verification on exact head**

Documentation changes embedded build identity, so rebuild and rerun:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Assert final root/loaded bundle identity, actual bytes/writers/native undo, Track Changes accept/reject where applicable, exact diagnostics/correction counts, sanitized requests/persistence. Record ultimate exact-head results in SDD ledger and PR evidence without recursively rewriting Stage 57.

- [ ] **Step 4: Obtain fresh independent whole-PR code and write/security review**

Give fresh reviewer complete `343f16ecb7c21cd6b181d61d27be1e76fd0764c1..HEAD` diff, plan, issue #79, Stages 38/51/56, actual evidence. Require separate spec/quality/write-security verdicts covering lossless strict/context lines and UTF-16; no Selection strictening/automatic expansion; semantic/review/payload distinctions; inline/table conservative boundaries/escapes; unchanged diagnostics/correction/privacy; unchanged target/freshness/writers/native handoff; complexity/malformed input; docs/evidence; absence of PR05/06/future scope.

Resolve every Critical/Important finding through same implementer/reviewer loop, rerun affected tests/full gates/relevant real scenarios. Commit each review fix separately with verification.

- [ ] **Step 5: Check submission boundary**

```bash
git status --short
git diff --name-only 343f16ecb7c21cd6b181d61d27be1e76fd0764c1..HEAD
git diff --name-only 343f16ecb7c21cd6b181d61d27be1e76fd0764c1..HEAD -- package.json package-lock.json manifest.json versions.json CHANGELOG.md .github
git diff --name-only 343f16ecb7c21cd6b181d61d27be1e76fd0764c1..HEAD -- src/chat-view.ts src/selection-editor.ts src/edit-freshness.ts src/note-writer.ts src/edit-target.ts src/main.ts src/operation-edit-strategy.ts src/replacement-diff.ts src/critic-markup.ts
git ls-files main.js test_vault
```

Expected: clean tracked worktree; only scoped scanner/policy/test/docs files; no version/workflow/controller/freshness/writer/compiler changes; no generated bundle/vault files tracked.

- [ ] **Step 6: Submit and stop at human gate**

```bash
git push -u origin feature/2.11-pr04-markdown-scanner
gh pr create --base main --title "refactor: consolidate Markdown structure scanning" --body "Resolves #79. Consolidates lossless Markdown lexical scanning behind named context and edit projections while preserving Selection expansion, Stage 38 conservative guards, diagnostics, PR 02 targeting, and PR 03 freshness/writers. Include exact-head gates, Linux loopback structural/context/writer/review evidence, limitations, and independent code/write-security review results in this PR."
gh pr checks --watch
```

Do not merge, tag, publish, manually close unrelated issues, or start PR 05. Confirm #79 closes only from actual merged PR scope; if anything remains incomplete, leave open with precise remaining work.

## Honest Evidence Limitations to Preserve

- This remains a targeted conservative scanner, not a universal CommonMark parser or complete rendering-compatibility claim.
- Unit tests use literal strings and Obsidian mocks; they cannot establish real host normalization, native undo, actual file bytes, or Track Changes presentation.
- Real evidence must record actual Linux/Xvfb environment, Obsidian version, Track Changes version, theme, CDP-driven input. No Windows, macOS, mobile, physical-input, screen-reader, third-party-theme, other-version, or unexercised popout-edge claim.
- Loopback OpenAI-compatible SSE with dummy SecretStorage credentials is not real-provider coverage. No real account, paid call, external network, or provider behavior may be claimed.
- CRLF byte behavior is pinned in unit tests. If Obsidian normalizes live editor, real evidence proves fail-closed preservation of raw disk bytes, not successful real CRLF editing.
- Track Changes exact accept/reject bytes are evidence only for actual installed companion version and exercised scenarios; no universal companion-version claim.
- Native undo applies to successful Selection replacement only. Full-note remains guarded `vault.modify` plus separate Track Changes review.
- Complexity statements describe expected asymptotic behavior, not measured performance unless actual benchmark recorded.
- Stage 57 owns code-head evidence; final exact-documentation-head gates, bundle identity, review, submission results belong in SDD ledger and PR rather than invented retroactively.
