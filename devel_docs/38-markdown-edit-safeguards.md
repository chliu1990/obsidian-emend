# Stage 38: Markdown edit safeguards

## Status and scope

Implementation and final verification are complete for PR #34 at commit `a75fb7f807d32a3047617c733ccc9a6c4d5eabca`. Full-note Edit and Modify Selection reject Operations whose CriticMarkup would be invisible or structurally unsafe in inline code, fenced code, or tables. The closed Operations protocol, existing occurrence and range-isolation rules, one-correction flow, guarded writers, and Track Changes review surface remain unchanged. The safeguards are targeted conservative scanners, not a full CommonMark parser or a claim of complete Markdown coverage.

Track Changes 2.3.0 is the verified review implementation. Raw CriticMarkup visible while the cursor is inside a table cell is upstream Obsidian/Track Changes presentation behavior, not a defect claimed to be fixed by Emend. Exact Markdown bytes after accept/reject are the correctness criterion. Earlier `evidence-fixed*` records are historical; the current head and final evidence are `evidence-fixed-v4` below.

## Inline code

A replacement whose target or replacement contains a backtick uses whole-target CriticMarkup rather than word-level fragmentation. Complete code-span replacements and larger targets containing complete spans therefore retain visible, reviewable delimiters.

A remove, replace, or comment target may intersect an inline code span only when it contains the complete span. Content-only and cross-delimiter targets fail with typed `inline-code-range` feedback identifying the operation, operation type, field, and one-based source line without including source or replacement text. Insertions strictly inside a span also fail; exact outside boundaries remain allowed unless inserted backticks would extend a delimiter run. These candidate-validation failures use the normal single correction opportunity, with at most two provider calls and no write unless a corrected candidate passes every guard.

Opening backticks retain Markdown escape handling. Closing runs are recognized regardless of preceding backslashes because escapes do not apply inside code spans. Matching stops at blank-line and actual block boundaries but preserves valid multiline spans within one paragraph, including lazy blockquote/list continuations. Inline HTML and autolinks do not incorrectly end those spans; recognized block-level HTML and valid fence openers do. Adjacent, multiline, unmatched, and odd/even-backslash cases are covered.

## Fenced code and review-parser compatibility

Semantic guards reject any target intersecting a fenced block, including larger containing targets and comment-only Operations, with `fenced-code-edit`. Backtick and tilde fences support container prefixes, blank-line handling, info-string rules, CRLF, and unclosed blocks. Backtick fence info strings containing backticks are not semantic fence openers, leaving inline-code scanning to classify them. Container structure uses normalized blockquote/list matching rather than literal prefixes, and unclosed container fences end when their containers end.

Track Changes 2.3.0 separately recognizes only bare fence openers indented by zero to three spaces and exact matching closing runs. Emend mirrors those compatibility exclusion ranges in addition to the semantic guards. A compatibility range continues through blank lines, container exits, prefixed delimiters, and different-length runs until the exact later bare delimiter or EOF. This covers list-created shadows and longer top-level closing runs. List-fence immediate or blank-separated following prose therefore rejects with zero writes, while top-level and blockquote following prose remains reviewable. Longer top-level closer following prose rejects, and an exact later bare delimiter ends the shadow correctly.

Semantic opening exemptions are scoped to the compatibility range opened by that same fence. A top-level or blockquote semantic opening nested inside a different review-parser shadow rejects instead of suppressing the other range.

Insertions at `closingContentEnd` before the original closing line ending always reject, including newline-prefixed text and EOF without a line ending. Insertion after the closing line ending is safe and yields one suggestion with exact accept/reject. Other exact before-opener boundaries require a trailing line break; backticks that would extend inline-code delimiter runs also reject.

Modify Selection passes the captured full note and absolute selection offsets into these classifiers. That context is used only to identify structure. Occurrence resolution and edit permissions still use only the captured `selectedText`; neither the target nor replacement range expands.

## Tables

Tables permit text edits wholly within one existing header or body cell. Safe cell insert, remove, replace, and comment Operations remain supported, including emptying cell text and using escaped `\|` text.

The following fail atomically with `table-structure-edit`:

- delimiter-row Operations;
- row/column additions or removals and targets spanning cells or rows;
- insertion anchors and insertion points in different cells;
- inserted text, replacements, or comments containing CR/LF or an unescaped `|` in a table;
- changes that alter unescaped-delimiter structure, cell count, outer-pipe identity, or table/block membership in the original, annotated, accepted, or rejected affected row.

Affected-row view validation uses actual `compiledText` from one replacement-compilation pass rather than synthetic whole-target markup. All Operations affecting an original row are composed in descending actual compiled-offset/request order; insertions use zero-width ranges at `insertionPoint`. Original, actual annotated, accepted, and rejected row signatures are compared together. Accepted rows are computed directly from Operation results, while rejected rows remain the original source.

This catches minimized delimiter fragmentation, multi-Operation backslash-parity changes, actual insertion-offset escapes, and four-space/tab indented-code exits in addition to backslash edits that expose delimiters, true HTML block starts such as `<div>`, and valid fence starts. Inline HTML such as `<span>`, autolinks, and backtick runs whose info string contains backticks remain safe cell content. Escaped pipes and ordinary cell text remain editable.

The scanner distinguishes escaped pipes using backslash parity, handles outer pipes with indentation/trailing whitespace and CRLF, and preserves absolute real-cell offsets. Header and delimiter rows must belong to the same validated container; unrelated prose with pipes is not promoted to a synthetic table. Table bodies stop at blank lines, fences, headings, blockquotes, lists, and thematic breaks.

## Validation order and comments

Exact original-snapshot occurrence resolution, malformed-operation checks, ambiguity checks, and existing range-isolation validation run before structural classification. The first structural violation in request order becomes bounded allowlisted feedback. One unsafe Operation rejects the entire candidate before CriticMarkup compilation or either writer runs; a second structurally invalid response is terminal after exactly two calls and zero writes.

Comments before and after replacements were rechecked in prose and tables. Their compilation and review order were correct, so comment/order semantics were not changed.

## Automated verification

The final local gate passed:

- **35 Vitest files and 817 tests**;
- strict TypeScript and production esbuild through `npm run build`;
- ESLint through `npm run lint`;
- `git diff --check` with no whitespace errors.

Coverage includes complete and partial inline spans, lazy multiline matching, inline HTML/autolinks, blank and block boundaries, escaped delimiters, affected-row review views, safe and unsafe table content, semantic and compatibility fence ranges, nested openings, exact closing-run termination, absolute selection mappings, typed feedback, two-invalid termination, corrected safe edits, and zero-write behavior. CRLF guard cases are covered by these automated tests.

## Final real-Obsidian verification

The production bundle at head `a75fb7f807d32a3047617c733ccc9a6c4d5eabca` has SHA-256 `562aff8c74a31f8f0fa54902d2529fa72d3f4507c730143df71128c37765fb4a`, identical to the copy loaded by the verification runtime. The runtime used official Obsidian 1.15.0, Track Changes 2.3.0, isolated Xvfb/CDP, and a Linux loopback OpenAI-compatible mock with dummy credentials. **66 scenarios passed with zero production failures; two CRLF setups were environment-limited. All 60 v3 scenarios remained green.**

Final evidence is under `test_vault/emend-table-verify/evidence-fixed-v4/`:

- `summary.json` records the head, bundle hash, runtime, scenario assertions, environment limits, and exact before/annotated/accepted/rejected bytes;
- `annotated/` and `resolved/` contain exact Markdown artifacts;
- `logs/` contains sanitized provider and Obsidian command/write logs;
- `screenshots/` contains review, accept/reject, invalid-state, and environment-limited captures;
- `dom/` contains the live table-cell presentation capture.

Key results:

1. Inline-code replacements in prose and tables, plus larger containing targets and safe boundary text, exposed reviewable suggestions with exact accept/reject and no raw suggestions after Accept All. Content-only targets used `inline-code-range` correction feedback, two calls, and one write only after a safe correction.
2. Added-column and broad-row candidates used `table-structure-edit`; corrected cell-only edits accepted with exact columns and bytes. Two structural-invalid responses made exactly two calls and zero writes.
3. Safe table Operations produced five suggestions and one comment. Backslash/delimiter and true HTML/fence block-start changes rejected, while escaped pipes, inline HTML, autolinks, and invalid backtick-fence info remained safe cell content with exact reconstruction.
4. Full-note and selection fenced-code attempts made two calls and zero writes. Selection diagnostics used full-note lines without target expansion.
5. List-created immediate and blank-separated following prose rejected. Top-level and blockquote following prose remained reviewable. Longer closers shadowed following content, and only the exact later bare delimiter terminated the shadow.
6. Nested semantic openings inside other review shadows rejected, while same-fence opening insertion outside other ranges remained safe.
7. Newline-prefixed insertion before the original closing line ending rejected; insertion after that line ending yielded one suggestion and exact accept/reject.
8. Lazy multiline spans, inline HTML/autolinks, blank/heading/HTML-block distinctions, and comment ordering retained their intended behavior.
9. Five composed-table invalid cases—minimized delimiter fragmentation, composed removals, four-space indentation, tab indentation, and actual-offset insertion—each made exactly two calls and zero writes. The ordinary cell and escaped-pipe controls remained safe with exact accepted/rejected structure.

## Verification limits

The two CRLF setups (`fence-list-safe-crlf` and `fence-closer-safe-crlf`) reproduced open-document stale normalization: exactly one request, zero writes, and exact original vault bytes preserved. They are environment-limited rather than production passes or failures; automated tests cover the corresponding CRLF guards.

Review cards were accepted through the official Track Changes command over actual cards in Source Mode. The matrix did not exercise one real-pointer batch-button flow. Verification was Linux loopback only; no real provider, Windows, or macOS run was performed. Not every fence delimiter or container layout was exercised in the runtime matrix, and no full CommonMark compatibility is claimed.
