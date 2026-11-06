# Stage 38: Markdown edit safeguards

## Status and scope

Implementation and verification are complete for PR #34 at commit `013e3f2eb8c343ffc83dee49623049b8614355f5`. Full-note Edit and Modify Selection now reject Operations whose CriticMarkup would be invisible or structurally unsafe in inline code, fenced code, or tables. The closed Operations protocol, existing occurrence and range-isolation rules, one-correction flow, guarded writers, and Track Changes review surface remain unchanged.

Track Changes 2.3.0 is the verified review implementation. Raw CriticMarkup visible while the cursor is inside a table cell is upstream Obsidian/Track Changes presentation behavior, not a defect claimed to be fixed by Emend. Exact Markdown bytes after accept/reject are the correctness criterion.

## Inline code

A replacement whose target or replacement contains a backtick uses whole-target CriticMarkup rather than word-level fragmentation. Complete code-span replacements and larger targets containing complete spans therefore retain visible, reviewable delimiters.

A remove, replace, or comment target may intersect an inline code span only when it contains the complete span. Content-only and cross-delimiter targets fail with typed `inline-code-range` feedback identifying the operation, operation type, field, and one-based source line without including source or replacement text. Insertions strictly inside a span also fail; exact outside boundaries remain allowed. These candidate-validation failures use the normal single correction opportunity, with at most two provider calls and no write unless a corrected candidate passes every guard.

Opening backticks retain Markdown escape handling. Closing runs are recognized regardless of preceding backslashes because escapes do not apply inside code spans. Adjacent, multiline, unmatched, and odd/even-backslash cases are covered.

## Fenced code

Track Changes 2.3.0 cannot review CriticMarkup inside fenced code. Any target intersecting a fenced block, including a larger target containing the block and comment-only Operations, fails with `fenced-code-edit`. Insertions strictly inside a fence or at EOF in an unclosed fence fail as well. Exact before/after boundaries of a complete block and the end of a container-terminated block remain editable.

Backtick and tilde fences support runs of at least three characters, matching close runs, info-string rules, CRLF, and unclosed blocks. Backtick fence info strings containing backticks are not treated as fences, leaving inline-code scanning to classify them. Blockquote/list containers use structural rather than literal-prefix matching, including optional blockquote whitespace and equivalent list indentation. An unclosed container fence ends when its container ends instead of consuming unrelated following prose.

Modify Selection passes the captured full note and absolute selection offsets into this classifier. That context is used only to identify Markdown structure. Occurrence resolution and edit permissions still use only the captured `selectedText`; neither the target nor replacement range expands.

## Tables

Tables permit text edits wholly within one existing header or body cell. Safe cell insert, remove, replace, and comment Operations remain supported, including emptying cell text and using escaped `\|` text.

The following fail atomically with `table-structure-edit`:

- delimiter-row Operations;
- row/column additions or removals and targets spanning cells or rows;
- insertion anchors and insertion points in different cells;
- inserted text, replacements, or comments containing CR/LF or an unescaped `|` in a table.

The scanner distinguishes escaped pipes using backslash parity, handles outer pipes with indentation/trailing whitespace and CRLF, and preserves absolute real-cell offsets. Header and delimiter rows must belong to the same validated container; unrelated prose with pipes is not promoted to a synthetic table. Table bodies stop at blank lines, fences, headings, blockquotes, lists, and thematic breaks.

## Validation order and comments

Exact original-snapshot occurrence resolution, malformed-operation checks, ambiguity checks, and existing range-isolation validation run before structural classification. The first structural violation in request order becomes bounded allowlisted feedback. One unsafe Operation rejects the entire candidate before CriticMarkup compilation or either writer runs; a second structurally invalid response is terminal after exactly two calls and zero writes.

Comments before and after replacements were rechecked in prose and tables. Their compilation and review order were correct, so comment/order semantics were not changed.

## Automated verification

The final local gate passed:

- **35 Vitest files and 764 tests**;
- strict TypeScript and production esbuild through `npm run build`;
- ESLint through `npm run lint`;
- `git diff --check` with no whitespace errors.

Coverage includes complete and partial inline spans, escaped delimiters, CRLF, table cell and structure Operations, unclosed/tilde fences, outer whitespace, nested containers, block-level termination, absolute selection mappings, typed feedback, two-invalid termination, corrected safe edits, and zero-write behavior.

## Real-Obsidian verification

The fixed production bundle had SHA-256 `245f9563dbe5ed3cc3835b6806e3d68da560169d03c3c9c72ebc1c4985f7c469`, matching the bundle loaded by the verification runtime. The runtime used official Obsidian 1.15.0, Track Changes 2.3.0, isolated Xvfb/CDP, and a Linux loopback OpenAI-compatible mock with dummy credentials. **20/20 scenarios passed** at head `013e3f2`.

Evidence is under `test_vault/emend-table-verify/evidence-fixed/`:

- `summary.json` records the head, bundle hash, runtime, scenario assertions, and exact before/annotated/accepted/rejected bytes;
- `annotated/` and `resolved/` contain exact Markdown artifacts;
- `logs/` contains sanitized provider and Obsidian command/write logs;
- `screenshots/` contains review, accept/reject, and invalid-state captures;
- `dom/` contains the live table-cell presentation capture.

Key results:

1. Inline-code replacements in prose and tables, plus a larger containing target, exposed one reviewable suggestion. Exact accept and reject restored the intended/original bytes, and Accept All left no raw suggestions.
2. A content-only inline target produced `inline-code-range` correction feedback, exactly two calls and one write, then a reviewable complete-span replacement.
3. An added-column candidate produced `table-structure-edit`, corrected to a cell-only replacement with two calls and one write, and accepted as a two-column table without an escaped structural pipe.
4. Two structural-invalid responses made exactly two calls and zero writes while preserving exact original bytes.
5. A broad row target corrected to two independent cell edits; both suggestions accepted and rejected exactly.
6. Safe table Operations produced five suggestions and one comment, including escaped-pipe insertion and cell removal/replacement/comment behavior. Accept All left only the expected comment.
7. Full-note and selection fenced-code remove/replace/comment/insert attempts each made two calls and zero writes. Selection diagnostics used full-note lines without expanding the selected target.
8. Independent insertions immediately before and after a fence were reviewable and accepted/rejected exactly.
9. Prose and table comments before/after replacements retained their expected order and resolved without an ordering regression.

## Verification limits

Review cards were accepted through the official Track Changes command in Source Mode. The matrix did not exercise a single real-pointer batch-button flow. Fence-before and fence-after insertions were independent scenarios, not two insertions at one same-anchor response. Other fence delimiters and container layouts have automated coverage but were not all included in the runtime matrix. Verification was Linux loopback only; no real provider, Windows, or macOS run was performed.
