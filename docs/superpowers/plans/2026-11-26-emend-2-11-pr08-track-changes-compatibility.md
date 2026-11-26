# Emend 2.11.0 PR 08 Track Changes Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove exact Track Changes compatibility for candidate table and other structural CriticMarkup encodings, add durable fixtures and current limitations, and land any necessary focused companion presentation change without enabling new Emend writes.

**Architecture:** Characterize the separately installed Track Changes companion in real Obsidian before changing tracked code. Promote the exercised bare and `author="Emend"` encodings into shared JSON fixtures consumed by Vitest and the ignored runtime harness; keep structural Operations rejected. If structural visualization is insufficient, confine the fix to a separately reviewed companion presentation PR while leaving parser, accept/reject operations, Emend writers, and Emend review ownership unchanged.

**Tech Stack:** Strict TypeScript, Vitest, existing CriticMarkup parser/replacement compiler/Markdown guards, ignored Linux Obsidian/Xvfb/CDP loopback harness, separately installed Track Changes 2.3.0, and conditional TypeScript changes in `philphilphil/obsidian-track-changes`. No new Emend runtime dependency or review renderer.

**Spec:** Approved global plan at `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, especially Global Constraints, Product Decisions > Tables/other elements/visualization, PR 08, and the PR workflow; [Issue #36](https://github.com/chliu1990/obsidian-emend/issues/36); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `ROADMAP.md`; `docs/guides/editing-and-review.md`; current canonical Stages [38](../../../devel_docs/38-markdown-edit-safeguards.md), [57](../../../devel_docs/57-markdown-scanner.md), and [60](../../../devel_docs/60-emend-authorship.md); current source at merged base `344a377837410bd91999d776c12a416ab305ec62`.

## Global Constraints

- Work only on `feature/2.11-pr08-track-changes-compatibility` in the approved worktree based at `344a377837410bd91999d776c12a416ab305ec62`.
- Track Changes integration is the approved direction; do not add an Emend-owned preview, diff, Apply/Accept/Reject UI, fork, bundled companion, or automatic installation.
- PR 08 is evidence and compatibility work. Do not enable table row/column/delimiter/cross-cell Operations, list/blockquote Operations, pending-card merging, or any new writer.
- Operations remain the only model-facing edit protocol. Existing occurrence, ambiguity, overlap, structural, freshness, correction, and atomic-write rules remain unchanged.
- Full-note Edit alone retains guarded `vault.modify`; Selection Edit and Modify Selection retain only native `editor.replaceRange` on the captured range.
- Every newly emitted Emend token retains exactly `author="Emend"` and no new date. Bare and supported other-author markup remains byte-exact.
- Structural fixtures are direct synthetic compatibility inputs, not evidence that Emend may compile or write those candidates.
- The installed baseline is Track Changes 2.3.0 from `philphilphil/obsidian-track-changes`, tag commit `9e34c3c`; resolve and record the full commit and actual bundle hashes before drawing conclusions.
- Separate repositories require separate branches, tests, reviews, PRs, and human gates. External companion submission, fork, publication, tag, or release requires explicit human approval.
- If a companion change is required, its approved change must merge before PR 09. Emend PR 08 may still be submitted independently with the remaining dependency stated precisely.
- Runtime verification uses only ignored `test_vault/` synthetic notes, loopback SSE/CORS, dummy credentials, and locally installed/built plugin bundles. No real or paid provider calls.
- Do not claim unexercised CRLF success, physical input, screen readers, other platforms, other Obsidian/companion versions, or real-provider behavior.
- Add Stage 61 and update current canonical owners. Do not rewrite historical Stage 38 or other historical results.
- Do not change `CHANGELOG.md`, version metadata, tags, releases, workflows, or Community Directory state.
- Submit only Emend PR 08 and stop at its human gate. Do not merge or start PR 09 automatically.

## Review Focus

- **Pipes and multiline structure:** raw and escaped pipes, row endings, and cross-cell tokens can make the annotated host preview invalid even when accept/reject is exact; Tasks 1 and 4 own real DOM/view comparisons and Task 2 owns exact byte fixtures.
- **Bare, attributed, and legacy markup:** new `Emend` tokens must not regress bare tokens, other-author/date metadata, comments, or ordinary prose; Tasks 1, 2, and 4 own paired fixtures and inherited PR 07 controls.
- **CRLF and host normalization:** direct companion resolution must preserve exact CRLF where the host permits it, while open-editor normalization must be reported rather than normalized away; Tasks 1 and 4 own the closed-note attempt and honest limits.
- **Companion presentation backward compatibility:** asynchronous previews must not create stale DOM, active-content surprises, changed source bytes, or altered Accept/Reject behavior; Task 3 owns focused companion tests and Task 4 owns legacy runtime regressions.
- **Accidental enablement or ownership drift:** PR 08 must not relax guards, add writers/review UI, bundle the companion, or claim evidence from a different bundle; Task 2 owns fail-closed tests, Task 4 owns writer/UI/bundle audits, and Tasks 5–6 own provenance and scope review.

---

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `tests/fixtures/track-changes-compatibility.json` | Shared exact original, bare annotated, Emend annotated, accepted, and rejected fixture bytes |
| `tests/track-changes-compatibility.test.ts` | Fixture schema/coverage, test-only accept projection, reject validation, change counts, legacy preservation, and unchanged guard rejection |
| `test_vault/emend-selection-chat-verify/` | Ignored real-Obsidian scenarios, synthetic notes, screenshots, DOM, byte artifacts, and evidence only |
| `devel_docs/61-track-changes-compatibility.md` | New current compatibility contract, selected encodings, versions/commits, evidence, reviews, limitations, and issue disposition |
| `AGENTS.md` | Durable companion separation and current compatibility ownership |
| `docs/guides/editing-and-review.md` | User-facing tested companion version, current structural-edit limits, and review boundaries |
| `IMPLEMENTATION_PLAN.md` | Architecture boundary and Stage 61 index entry |
| `ROADMAP.md` | Current 2.11 scoped status, PR 09 dependency, and Issue #36 remaining open |
| Companion `src/panel/view.ts` and conditional focused helper/tests | Conditional structural card presentation only, if Task 1 proves this is the failing surface |
| Companion `src/editor/decorations.ts` or `src/reading.ts`/`src/reading-plan.ts` | Only the exact observed presentation failure; not default combined scope |
| Companion `test/structural-preview.test.mjs` and `package.json` | Conditional companion regression test and test-script registration, without version changes |

### Task 0: Save the Plan and Confirm the Base

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-emend-2-11-pr08-track-changes-compatibility.md`

**Interfaces:**
- Consumes: Approved PR 08 scope and merged base `344a377837410bd91999d776c12a416ab305ec62`.
- Produces: One builder-reviewed implementation plan and one SDD todo per subsequent task.

- [ ] **Step 1: Confirm workspace and baseline**

Confirm the branch is not `main`, `git merge-base HEAD main` is the approved base or the explicitly supplied merged-main commit, tracked files are clean, Stage 61 does not exist, and the baseline test suite is green.

- [ ] **Step 2: Save and builder-review the plan**

Review fixture exactness, real-Obsidian decision criteria, companion repository separation, no-write scope, CRLF honesty, review-after-every-task, and issue disposition. Resolve every material builder finding before implementation.

- [ ] **Step 3: Commit only the plan**

```bash
git add docs/superpowers/plans/2026-11-26-emend-2-11-pr08-track-changes-compatibility.md
git commit -m "docs: plan Track Changes compatibility"
```

### Task 1: Characterize Real Track Changes 2.3.0 and Choose the Compatibility Direction

**Files:**
- Ignored only: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored only: `test_vault/emend-selection-chat-verify/mock-provider.mjs`
- Ignored only: `test_vault/emend-selection-chat-verify/compatibility-fixtures.json`
- Ignored only: evidence under `test_vault/emend-selection-chat-verify/evidence-pr08-*/`

**Interfaces:**
- Consumes: PR 07 harness at `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr07-emend-authorship/test_vault/emend-selection-chat-verify/`, installed companion manifest/source, and upstream tag `2.3.0` at `9e34c3c`.
- Produces: Ignored `summary.json`, exact byte/DOM artifacts, and `compatibility-decision.json`:

```ts
type CrlfStatus = 'passed' | 'environment-limited' | 'failed';

interface CompatibilityDecision {
	companionVersion: string;
	companionCommit: string;
	byteCompatible: boolean;
	presentationCompatible: boolean;
	companionChangeRequired: boolean;
	crlfStatus: CrlfStatus;
	selectedFixtureIds: string[];
	limitations: string[];
	rationale: string;
}
```

- [ ] **Step 1: Provision the inherited harness and prove its failing control**

Copy the ignored PR 07 harness and required local Obsidian/Xvfb/CDP tools into this worktree without modifying the source worktree. Use the existing separately installed Track Changes files and dummy SecretStorage credential.

Resolve the full upstream tag commit and record local/loaded hashes:

```bash
git ls-remote https://github.com/philphilphil/obsidian-track-changes.git 'refs/tags/2.3.0*'
sha256sum test_vault/.obsidian/plugins/track-changes/main.js
```

Add scenario `track-changes-compatibility-intentional-harness-failing-control`. Run:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --track-changes-compatibility-failing-control
```

Expected: nonzero exit, zero passed scenarios, and a summary identifying the intentional harness failure rather than a product failure.

- [ ] **Step 2: Add the ignored characterization fixture catalog**

Create paired bare and `{author="Emend"...}` forms. Use LF for every fixture except `table-crlf-row-replace`. Every original, annotated, accepted, and rejected document ends with exactly one final LF, or final CRLF for the CRLF fixture. Complete-row token payloads include the target row’s own terminating line ending; they never absorb the preceding row’s ending.

Use these exact source constants:

```ts
const H2 = '| A | B |';
const D2 = '| --- | --- |';
const R1 = '| one | two |';
const R2 = '| keep | last |';
const TABLE = `${H2}\n${D2}\n${R1}\n`;
const H3 = '| A | B | C |';
const D3 = '| --- | --- | --- |';
const R3 = '| one | two | three |';
const TABLE3 = `${H3}\n${D3}\n${R3}\n`;
const ESCAPED_OLD = 'one \\| two';
const ESCAPED_NEW = 'first \\| second';
```

`ESCAPED_OLD` contains one backslash byte followed by one pipe byte.

| Fixture ID | Exact token payload and placement |
| --- | --- |
| `legacy-prose` | Original `Alpha beta.\n`; substitution `beta~>Beta`, insertion `!` immediately before `.` |
| `table-cell-escaped-pipe-whole-cell` | One synthetic substitution with content `one \\| two~>first \\| second` |
| `table-cell-escaped-pipe-minimized` | Exact actual compiler result: `{author="Emend"~~one~>first~~} \| {author="Emend"~~two~>second~~}` |
| `table-row-insert-append` | Insert `| middle | added |\n` in one insertion token immediately after the final existing body row |
| `table-row-insert-interior` | Original includes R1 then R2; insert `| middle | added |\n` after R1’s LF and before R2 |
| `table-row-delete` | Original includes R1 then R2; delete the complete payload `| one | two |\n` |
| `table-row-replace` | Substitute `| one | two |\n~>| first | second |\n` |
| `table-column-add-whole-table` | Substitute complete `TABLE`, including final LF, with `TABLE3` |
| `table-column-add-per-row` | Three substitutions: H2→H3, D2→D3, R1→R3; the body payload includes final LF |
| `table-column-delete-whole-table` | Substitute complete `TABLE3`, including final LF, with `TABLE` |
| `table-column-delete-per-row` | Three substitutions: H3→H2, D3→D2, R3→R1; the body payload includes final LF |
| `table-delimiter-replace` | Substitute `| --- | --- |\n~>| :--- | ---: |\n`; delimiter LF is inside both payloads |
| `table-cross-cell-replace` | Substitute `one | two~>first | second`; no newline in either payload |
| `table-crlf-row-replace` | Entire document uses CRLF; substitute `| one | two |\r\n~>| first | second |\r\n` |
| `list-item-insert` | Original `- one\n`; insertion payload `- two\n` at EOF |
| `list-item-delete` | Original `- one\n- two\n`; deletion payload `- two\n` |
| `blockquote-line-replace` | Original `> one\n> keep\n`; substitute `> one\n~>> two\n` |

Every fixture includes exact `original`, `bareAnnotated`, `emendAnnotated`, `accepted`, `rejected`, `changeCount`, `disposition`, and optional `limitation`. `rejected` equals `original`. Bare forms replace only the new-token prefix `{author="Emend"` with `{`; they do not normalize any other byte. A rejected alternative requires a nonempty limitation.

Default dispositions, changed only with recorded contrary Task 1 evidence:

- Rejected alternative: `table-cell-escaped-pipe-whole-cell`, limited as `Synthetic whole-cell control; actual minimized Emend output uses two substitutions around the escaped pipe.`
- Rejected alternatives: whole-table column add/delete, limited as `Whole-table substitution replaces unaffected rows; retained as an alternative to the per-row encoding.`
- Selected: all other fixtures, with CRLF still governed independently by `crlfStatus`.

The real Emend loopback scenario uses `table-cell-escaped-pipe-minimized`, not the whole-cell synthetic control. Add an exact `createReplacementCompiler()(ESCAPED_OLD, ESCAPED_NEW)` assertion for the two minimized substitutions. Direct synthetic whole-cell compatibility bytes are not actual compiler-output evidence.

- [ ] **Step 3: Exercise real Emend output and direct structural fixtures**

Before every table presentation scenario, write raw fixture bytes before opening the note, open deterministically in Source Mode with markdown leaf view state `mode: 'source'`, and compare editor and disk values with the exact fixture before invoking Track Changes. Switch to Live Preview only after this preflight, place the cursor outside tokens, and compare bytes again before DOM assertions. Any formatter difference is a harness setup/normalization finding, never a reason to edit expected bytes.

If Obsidian formats a top-level table, use a runtime-only list-contained variant derived independently for every byte field: preserve the final newline, prefix the first row with `- ` and later rows with two spaces. Apply the mapping independently to original, bare annotated, Emend annotated, accepted, and rejected. Record `runtimeVariantOf: <original fixture ID>` and exact mapped bytes. Do not normalize CRLF, silently update expectations, or claim top-level host presentation from a list-contained variant; top-level direct byte tests remain separate.

Add `--track-changes-compatibility` with these scenario groups:

- `01-emend-safe-cell-and-legacy-byte-contract`: use a deterministic loopback Full-note Edit to produce the minimized escaped-pipe cell changes through actual Emend compilation. Assert one guarded write and exact attributed bytes. Treat direct structural fixture insertion as test setup with zero Emend writer calls, not writer enablement.
- `02-structural-review-cards-and-resolution`: for every selected non-CRLF bare and attributed fixture, open the actual `tc-review-panel`, assert expected suggestion/card counts and exact old/new content, then use actual card Accept/Reject controls on independent reset copies. Await both editor and disk updates and compare every byte. Rejected alternatives remain evidence but do not gate the verdict.
- `03-source-live-preview-reading-presentation`: inspect Source Mode, Live Preview with the cursor outside all tokens, Live Preview with the cursor inside a token, and Reading view. Record raw delimiter visibility, decoration/card counts, structures present, and exact bytes. Require actual old and new structural card previews: old DOM/structure matches the complete rejected control and new DOM/structure matches the complete accepted control, including insertion and deletion cards. Reading accepted-view equivalence is supplementary and cannot compensate for a missing old/deleted preview.
- `04-crlf-and-legacy-controls`: run CRLF separately from open-editor cards through the deterministic closed-file SourceEdit/application path below. Include legacy prose and PR 07 bare/other-author/comment controls.
- `05-writer-ui-bundle-and-provenance-audit`: assert direct fixtures cause zero Emend writes, safe Selection controls retain native undo/redo, Emend exposes no Accept/Reject UI, Emend and Track Changes are separately installed plugins, and root/loaded Emend and companion hashes match their staged sources.

For separate CRLF accept and reject cases, write exact annotated CRLF bytes without opening a Markdown editor; construct exact companion `SourceEdit` values with raw-token `from`/`to`/`expected` and old/new `insert`; obtain the actual review panel’s `PanelHost` and call its real `applyEdits(file, [edit])`. Assert no Markdown leaf/editor exists, the host delegates to real `applyEditsToFile`, instrumented `app.vault.process` executes exactly once with the expected latest source, zero CM dispatch/`editor.setValue` calls occur, and exact accepted or rejected CRLF disk bytes result. This is SourceEdit/application-path coverage, not card coverage.

Set `crlfStatus: 'passed'` only when both accept and reject complete that path exactly. Use `'environment-limited'` when the no-editor PanelHost/`Vault.process` path cannot be established, with setup evidence and no success claim. Use `'failed'` when the path executes but `Vault.process` is bypassed, bytes differ, or line endings normalize. Overall compatibility requires `crlfStatus !== 'failed'`; an environment-limited result remains a prominent PR 09 limitation.

Source Mode showing exact raw markup is expected. Live Preview exposing raw markup only while the cursor touches a token is documented legacy editing behavior, not by itself a compatibility failure.

- [ ] **Step 4: Run the complete baseline matrix**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --track-changes-compatibility
node test_vault/emend-selection-chat-verify/verify.mjs --emend-authorship
```

Preserve annotated/accepted/rejected Markdown, DOM, screenshots, sanitized commands/writer logs, and `summary.json`. Unexpected byte failures, missing cards, harness errors, or writer violations must fail the run. Presentation observations must all complete before assigning the compatibility verdict.

- [ ] **Step 5: Apply the decision criteria**

Set `byteCompatible: true` only if every selected non-CRLF bare and attributed fixture has the expected actual cards and exact independent accept/reject bytes, legacy controls remain unchanged, and `crlfStatus !== 'failed'`. `selectedFixtureIds` contains only `disposition === 'selected'` IDs. Rejected alternatives do not gate the verdict, but every required row insertion/deletion, column addition/deletion, delimiter, cross-cell, list, and blockquote family must retain a selected encoding; otherwise compatibility is unproven and PR 09 remains blocked.

Set `presentationCompatible: true` only if:

1. every suggestion remains visible and operable with exact old/new content;
2. no unexplained raw delimiters appear in Live Preview with the cursor outside the token;
3. every selected structural fixture has actual old and new structural card previews matching complete rejected and accepted controls respectively, including insertions and deletions; Reading accepted-view equivalence is supplementary only; and
4. Source Mode and intentional cursor-inside raw behavior remain unchanged.

If bytes fail, do not label the issue merely presentational or enable writes; escalate for a human scope decision. An environment-limited CRLF result alone does not force that escalation, but remains an explicit PR 09 limitation. If bytes pass but structural presentation fails, set `companionChangeRequired: true` and identify the single failing surface. If both pass, record Track Changes 2.3.0 as sufficient and choose fixtures/docs only.

Prefer the smallest complete structural encoding that satisfies the matrix and preserves unaffected rows byte-for-byte. Do not prefer whole-table substitution merely to conceal a per-row presentation failure.

- [ ] **Step 6: Obtain independent evidence review and human direction**

Require fresh spec-compliance and quality reviews of the fixture matrix, actual DOM/card evidence, exact bytes, decision logic, and limitations. Then obtain human approval before modifying a separate companion checkout or submitting anything externally. Commit no harness or evidence artifact.

### Task 2: Add Durable Compatibility Fixtures and Fail-Closed Unit Tests

**Files:**
- Create: `tests/fixtures/track-changes-compatibility.json`
- Create: `tests/track-changes-compatibility.test.ts`

**Interfaces:**
- Consumes: The exact Task 1 exercised fixtures and current `parseCriticMarkup`, `toRejectView`, `prepareCriticMarkupEdit`, and `findMarkdownEditViolation`.
- Produces:

```ts
type FixtureDisposition = 'selected' | 'rejected-alternative';

interface TrackChangesCompatibilityFixture {
	id: string;
	family:
		| 'legacy'
		| 'table-cell'
		| 'table-row'
		| 'table-column'
		| 'table-delimiter'
		| 'table-cross-cell'
		| 'list'
		| 'blockquote';
	disposition: FixtureDisposition;
	limitation?: string;
	original: string;
	bareAnnotated: string;
	emendAnnotated: string;
	accepted: string;
	rejected: string;
	changeCount: number;
}

function parseFixtureCatalog(value: unknown): TrackChangesCompatibilityFixture[];
```

Load bytes without a TypeScript JSON import or `tsconfig.json` change:

```ts
import { readFileSync } from 'node:fs';

const raw: unknown = JSON.parse(readFileSync(
	new URL('./fixtures/track-changes-compatibility.json', import.meta.url),
	'utf8',
));
const fixtures = parseFixtureCatalog(raw);
```

`parseFixtureCatalog` validates plain records, unique nonempty IDs, enum values, byte strings, nonnegative integer counts, `rejected === original`, and nonempty `limitation` for every rejected alternative without an unchecked cast. No production API is added. The test-only accept projection is not evidence of companion behavior.

- [ ] **Step 1: Write failing fixture-catalog tests**

Import the not-yet-tracked JSON catalog and add:

- `validates the fixture catalog and required structural families`: unique IDs, every Task 1 ID present, rejected equals original, bare and Emend forms both present, and expected change counts.
- `validates unknown fixture data without a TypeScript JSON import`
- `requires a documented limitation for every rejected alternative`
- `exposes only selected fixtures to PR 09 selectedFixtureIds`
- `keeps every required structural family represented by a selected encoding`
- `$id reconstructs exact bare accept and reject bytes`
- `$id reconstructs exact Emend-attributed accept and reject bytes`
- `$id preserves reject-view equality and expected change counts`

Use a local `toAcceptView` helper like the existing `tests/replacement-diff.test.ts` helper. Assert `prepareCriticMarkupEdit(original, annotated)` returns the exact annotated source and expected count.

- [ ] **Step 2: Add current-behavior characterization controls**

Add `keeps row, column, delimiter, and cross-cell Operations fail-closed`, calling `findMarkdownEditViolation` for each structural class and asserting `table-structure-edit` with the correct field/line. These may pass immediately; record them as characterization controls, not manufactured RED.

Add `preserves legacy other-author metadata byte-for-byte` using an existing other-author/date token followed by a new `Emend` token outside it. Assert raw-token preservation and independent accept/reject reconstruction.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/track-changes-compatibility.test.ts
```

Expected: failure because `tests/fixtures/track-changes-compatibility.json` does not yet exist.

- [ ] **Step 4: Add the exact exercised JSON catalog**

Promote the Task 1 fixture bytes, dispositions, limitations, and selected IDs without changing encodings to make tests easier. If Task 1 disproved a candidate, retain it only with `disposition: 'rejected-alternative'` and a nonempty limitation; do not silently select it for PR 09 or let it satisfy a required family.

- [ ] **Step 5: Run GREEN and regression gates**

```bash
npx vitest run tests/track-changes-compatibility.test.ts tests/critic-markup.test.ts tests/replacement-diff.test.ts tests/markdown-edit-guards.test.ts
npm test
npm run lint
npm run build
git diff --check
```

Expected: all pass, with no production source diff and no newly enabled structural Operation.

- [ ] **Step 6: Obtain independent task reviews and commit**

Require spec-compliance and quality review of exact bytes, fixture provenance, test-only projection limits, and unchanged guards. Then:

```bash
git add tests/fixtures/track-changes-compatibility.json tests/track-changes-compatibility.test.ts
git commit -m "test: record Track Changes compatibility fixtures"
```

### Task 3: Conditionally Land a Separate Companion Presentation PR

**Precondition:** Execute only when Task 1 proves a focused companion presentation change is necessary and the human approves separate checkout work. If upstream current main already fixes the observed failure, test and record that exact version/commit instead of opening a redundant PR.

**Separate repository:** `https://github.com/philphilphil/obsidian-track-changes`

**Files, preferred structural-card seam:**
- Create in companion checkout: `docs/superpowers/plans/2026-11-26-structural-review-previews.md`
- Create: `src/panel/structural-preview.ts`
- Modify: `src/panel/view.ts` (`renderDiff` and the text-only suggestion rendering seam)
- Modify if spacing is required: `styles.css`
- Create: `test/structural-preview.test.mjs`
- Modify only the `test` script: `package.json`

**Alternative single-surface seams:** Use `src/editor/decorations.ts` only for cursor-outside Live Preview failure, or `src/reading.ts` plus `src/reading-plan.ts` only for a locally correctable Reading-view failure. Do not implement multiple surfaces by default. Do not change `src/parser.ts`, `src/operations.ts`, accept/reject commands, or writer/rebase logic for a presentation fix.

**Interfaces, if structural cards are the observed gap:**

```ts
import type { ChangeNode } from '../parser';

export type StructuralPreviewSide = 'old' | 'new';
export type StructuralPreviewKind = 'table' | 'list' | 'blockquote';

export interface StructuralPreview {
	kind: StructuralPreviewKind;
	source: string;
}

export function getStructuralPreview(
	documentSource: string,
	change: ChangeNode,
	side: StructuralPreviewSide,
): StructuralPreview | undefined;
```

`documentSource` is the complete current panel source and `change` is the exact node from `parse(documentSource)`. Return `undefined` if `documentSource.slice(change.from, change.to) !== change.raw`. Build the complete same-side document projection: old rejects every suggestion, new accepts every suggestion, and both remove comments and unwrap highlights/AI-text. Track the target change’s resolved range after preceding replacements; for a zero-width result, use its resolved insertion point with inclusive structure-boundary matching.

Extract the complete affected table/list/blockquote containing that range and return its exact bytes, including its final line ending. Return `undefined` when no single complete containing structure exists, the target crosses structure boundaries, either side is structurally invalid, or the structure contains active content. Active-content rejection conservatively covers every `![` occurrence (including wikilink, inline, reference, collapsed, and shortcut images), raw HTML/autolink `<...>` forms, and fenced blocks. Partial structures, prose, and active content retain literal fallback.

For multiple per-row cards, each card previews the complete document-wide rejected and accepted controls, not an undocumented intermediate state after resolving only that card. Record this deterministic UX rule in the companion plan and Stage 61.

`ReviewPanelView.renderDiff` requests both sides and enters structural rendering only when both return the same structure kind; otherwise existing literal rendering remains exact. Render two labelled regions `.tc-structural-preview-old[data-tc-preview-kind]` and `.tc-structural-preview-new[data-tc-preview-kind]`, compared with rejected and accepted controls respectively. Ordinary addition/deletion/substitution cards retain their current one-sided or character-diff presentation.

Keep literal text as the immediate fallback and use Obsidian `MarkdownRenderer` only for a recognized payload, with refresh-generation and `isConnected` checks before replacing fallback DOM. No `innerHTML`, new dependency, source write, or stale asynchronous replacement is permitted.

- [ ] **Step 1: Write and review the separate companion plan**

Confirm the failure on the current upstream default branch, record the full base commit, and write a focused companion plan containing the observed evidence, one presentation surface, exact fallback behavior, tests, runtime matrix, and human submission/merge gates.

Commit only that plan in the companion repository:

```bash
git add docs/superpowers/plans/2026-11-26-structural-review-previews.md
git commit -m "docs: plan structural review previews"
```

- [ ] **Step 2: Write failing companion tests**

Add pure-helper tests covering every Task 1 fixture on both old/new sides, exact extracted structure bytes, per-row multi-card projections, delimiter LF, CRLF retention, and active-content rejection. Add literal fallback for standalone row text without a complete table, a delimiter row without header/body, cross-cell text outside a table, malformed/unclosed structures, and ordinary legacy prose.

Add controllable deferred-`MarkdownRenderer.render` scenarios:

- `stale A/B resolution is discarded`: defer A, refresh to B, resolve A last and assert no A DOM appears; resolve B and assert only B’s old/new previews remain.
- `disconnected panel ignores deferred completion`: close/detach before resolution and assert no exception, reattached node, or stale update.
- `active content never calls MarkdownRenderer`: separately use `![[Embedded]]`, `![](https://127.0.0.1/image.png)`, `![alt][image]` with an in-structure `[image]: https://127.0.0.1/image.png` definition, collapsed/shortcut images, and raw HTML; assert zero renderer calls, exact literal fallback, and zero image/network requests.
- `literal fallback preserves legacy cards`: ordinary prose additions/deletions retain one-sided cards and substitutions retain character diff/highlighting.
- `old and new structural previews match rejected and accepted controls`: assert both regions for every selected structural encoding.
- `presentation does not change source resolution`: after deferred/stale rendering settles, actual Accept/Reject still produces exact original fixture bytes.

Keep real-renderer runtime smoke separately rather than substituting mocks for all Obsidian evidence.

Run:

```bash
node test/structural-preview.test.mjs
```

Expected: failure because the helper/rendering seam does not exist.

- [ ] **Step 3: Implement the minimal presentation-only change**

Keep `renderTextInto` for ordinary content. Render only complete supported structural payloads, use a child rendering lifecycle owned by the panel, and prevent stale asynchronous DOM replacement. Preserve existing text selection, card actions, author/date metadata, and Accept/Reject handlers.

Do not alter parsing, source edits, manifest/package versions, plugin installation, or Emend code.

- [ ] **Step 4: Run companion static and runtime gates**

Register the focused test in the existing `test` script, then run:

```bash
node test/structural-preview.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

Install only the built companion files into the ignored Emend verification vault. Run `--track-changes-compatibility`, `--emend-authorship`, and `--markdown-scanner`, recording both Emend and companion root/loaded hashes. Require exact bytes and unchanged legacy behavior.

- [ ] **Step 5: Obtain independent companion reviews and commit**

Require spec-compliance, quality, and presentation/privacy reviews, including stale render races, active-content fallback, ordinary prose, source-byte invariance, and unchanged review commands. Then:

```bash
git add src/panel/structural-preview.ts src/panel/view.ts styles.css test/structural-preview.test.mjs package.json
git commit -m "fix: render structural review previews"
```

Adjust the file list if the evidence selected the single Live Preview or Reading seam instead.

- [ ] **Step 6: Stop for explicit submission approval and human merge**

Do not push, open an upstream PR, fork, tag, or publish without explicit approval. Once authorized, submit the separate companion PR with baseline/fixed evidence and stop. Record its URL, reviewed head, merged commit, and released version only when actually known.

If the companion PR is declined or remains unmerged, Emend PR 08 may still proceed with honest limitations, but PR 09 remains blocked and no compatible enhanced-visualization version may be claimed.

### Task 4: Verify the Selected Companion and Complete Legacy Runtime Coverage

**Files:**
- Ignored only: final runtime harness/evidence under `test_vault/emend-selection-chat-verify/`
- No tracked production files.

**Interfaces:**
- Consumes: Task 2 fixtures and either proven Track Changes 2.3.0 or the exact merged companion commit from Task 3.
- Produces: Final focused and inherited runtime evidence, exact bundle identities, selected encoding rationale, and honest unresolved limits.

- [ ] **Step 1: Verify actual cards, views, and exact resolution bytes**

Run the complete matrix on the selected companion. For every selected non-CRLF fixture, assert actual visible review cards, old structural previews matching complete rejected controls, new structural previews matching complete accepted controls, Source Mode raw bytes, cursor-outside Live Preview behavior, supplementary Reading view, and independent accept/reject bytes.

Include bare, `Emend`, legacy other-author/date, comments, escaped pipes, interior/append row insertion, whole/per-row column addition/deletion candidates, lists, blockquotes, dispositions/limitations, selected IDs, host-formatter preflight, runtime-variant mappings, and failing controls. Record `crlfStatus` independently from open-editor cards through the closed-file SourceEdit/application path; where it cannot be established, record environment-limited evidence rather than success. Include deferred renderer, disconnected panel, active-content, literal-fallback, and post-render source-resolution results when a companion patch is selected.

- [ ] **Step 2: Audit writer, native undo, UI, and bundle boundaries**

Assert structural fixture setup makes zero Emend writer calls. For the real safe-cell Selection control, assert one native replacement, zero guarded vault writes, unchanged outside bytes, and native undo/redo. Full-note controls retain one guarded write and zero native replacements.

Assert no Emend Accept/Reject/diff UI, no bundled or auto-installed companion, separate plugin manifests, matching root/loaded Emend hashes, and matching selected-companion source/loaded hashes.

- [ ] **Step 3: Run focused and inherited runtime groups**

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --track-changes-compatibility
node test_vault/emend-selection-chat-verify/verify.mjs --emend-authorship
node test_vault/emend-selection-chat-verify/verify.mjs --in-token-rejection
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
node test_vault/emend-selection-chat-verify/verify.mjs
```

Run the intentional failing control separately and require nonzero exit. Require zero unexpected failures and `loadedBundleMatchedRoot: true` in every green Emend summary.

- [ ] **Step 4: Audit privacy and evidence provenance**

Inspect actual request bodies, note bytes, writer/command logs, saved chats, screenshots, and DOM. Require no credentials, authorization headers, raw rejected candidates, correction diagnostics, or source snapshots in ready persistence. Distinguish direct companion fixtures from actual Emend loopback writes.

- [ ] **Step 5: Obtain independent runtime reviews**

Require fresh spec-compliance, quality, and write/privacy factual reviews. Record actual Linux kernel/platform, Obsidian version, theme, companion version/commit/hash, CDP input method, loopback endpoint, and all unexercised limits. Commit no runtime artifact.

### Task 5: Add Stage 61 and Update Canonical Ownership

**Files:**
- Create: `devel_docs/61-track-changes-compatibility.md`
- Modify: `AGENTS.md:16-24,72-74,124-144`
- Modify: `docs/guides/editing-and-review.md:14-34,126-155`
- Modify: `IMPLEMENTATION_PLAN.md:15,41-50,52-101`
- Modify: `ROADMAP.md:30-35`

**Interfaces:**
- Consumes: Tasks 1–4 actual evidence and any merged companion identity.
- Produces: Current compatibility ownership without claiming PR 09/10 behavior.

- [ ] **Step 1: Write Stage 61 from actual results**

Record:

- base/branch and production/evidence heads;
- installed Track Changes 2.3.0, full tag commit, local/loaded hashes, and upstream repository;
- any companion PR, reviewed head, merge commit, and actual released version, without inventing one;
- exact fixture schema, selected/rejected dispositions, limitations, and `selectedFixtureIds` coverage of every required family;
- bare versus attributed cards and exact accept/reject bytes;
- Source Mode formatter preflight, any `runtimeVariantOf` mappings, Live Preview/Reading/card matrices, escaped pipes, multiline structures, lists, and blockquotes;
- old/rejected and new/accepted card-control comparisons, with Reading labelled supplementary;
- independent `crlfStatus` and closed-file SourceEdit/application evidence or environment limit;
- deferred renderer, disconnected panel, active-content, literal-fallback, and post-render source-resolution results when applicable;
- RED/GREEN/static/runtime commands and independent reviews;
- writer/native-undo/privacy/bundle audits;
- Linux/Obsidian/theme/input/accessibility/provider limits;
- remaining companion dependency and PR 09 blocker, if any.

Explicitly state that structural Operations remain rejected and that direct fixtures are not writer-enablement evidence. Do not modify Stage 38.

- [ ] **Step 2: Update contributor and architecture contracts**

In `AGENTS.md` and `IMPLEMENTATION_PLAN.md`, link Stage 61 as the current Track Changes compatibility record. Preserve conservative guards, separate companion ownership, raw-token preservation, both writers, freshness, correction, and the single review surface. Add Stage 61 to the numbered index.

State the precise compatible companion version/commit only for the surface actually verified. If a required companion PR is unmerged, state that PR 09 is blocked rather than implying support.

- [ ] **Step 3: Update the editing guide and roadmap**

Add a concise compatibility note to the editing guide:

- Track Changes 2.3.0 is the baseline tested version for current bare and `Emend` markup.
- Current Emend still permits table text edits only within one existing cell; row, column, delimiter, and cross-cell Operations remain rejected.
- Structural compatibility fixtures do not enable PR 09/10 features.
- Raw Source Mode and cursor-inside markup behavior are not an Emend review UI.
- Record only actually verified companion presentation limits and compatible versions.

In `ROADMAP.md`, add current 2.11 scoped compatibility status, link Stage 61, keep Issue #36 open, and identify any merged-companion dependency for PR 09. Do not call the branch released or merged.

- [ ] **Step 4: Record Issue #36 disposition**

Use `Refs #36`, not `Closes #36`. Include this post-merge comment template in Stage 61 and the PR body:

> PR 08 added Stage 61 and durable bare/`author="Emend"` compatibility fixtures against Track Changes 2.3.0. It verified the exercised review cards, source/reading presentation, exact accept/reject bytes, and current limitations. [State the merged companion PR/version, or state why none was required, or identify the remaining PR 09 companion gate.] Structural Emend Operations remain disabled here and belong to PR 09/10. No Emend review UI, bundling, auto-install, fork, or renderer was added. The 2.11 direction remains Track Changes integration; #36 stays open for unscoped external-dependency limitations and any future fork-versus-renderer decision.

- [ ] **Step 5: Run documentation checks and independent factual review**

Run relative-link/anchor and stale-claim audits over changed documents and:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Require independent spec-compliance, quality, and factual documentation reviews against current source and actual evidence.

- [ ] **Step 6: Commit canonical documentation**

```bash
git add AGENTS.md docs/guides/editing-and-review.md IMPLEMENTATION_PLAN.md ROADMAP.md devel_docs/61-track-changes-compatibility.md
git commit -m "docs: record Track Changes compatibility"
```

### Task 6: Final Gates, Broad Review, and Emend PR Submission

**Files:**
- Review the complete `344a377837410bd91999d776c12a416ab305ec62..HEAD` diff.
- Final-head runtime/gate evidence belongs in the PR body, not a recursive Stage 61 rewrite.

- [ ] **Step 1: Run focused and complete local gates**

```bash
npx vitest run tests/track-changes-compatibility.test.ts tests/critic-markup.test.ts tests/replacement-diff.test.ts tests/markdown-edit-guards.test.ts
npm ci
npm test
npm run lint
npm run build
git diff --check
```

`npm ci` may be omitted only with installed dependencies and an unchanged lockfile. Repeat documentation link/anchor checks.

- [ ] **Step 2: Verify the exact submitted runtime head**

Rebuild and rerun at least `--track-changes-compatibility` plus the intentional failing control on the final head. If any production/build change occurred after Task 4, rerun every affected inherited group. Record final root/loaded Emend and selected-companion identities in the PR body; do not borrow an earlier head’s runtime claim.

- [ ] **Step 3: Inspect scope and artifacts**

Confirm the Emend diff contains only the plan, fixtures/tests, and current documentation unless a review explicitly approved another scoped change. Confirm no `src/` guard relaxation, writer enablement, generated bundle, vault content, evidence, credential, historical-stage, version, workflow, release, or PR 09/10 change is present.

- [ ] **Step 4: Obtain fresh whole-PR reviews**

Require independent spec-compliance, quality, write/privacy, public UX, and documentation/evidence verdicts. Review every Review Focus item, exact accept/reject bytes, actual cards/views, legacy behavior, companion PR separation, CRLF honesty, no Emend-owned UI, and issue status. Fix Critical/Important findings through the owning implementer and rerun affected plus full gates.

- [ ] **Step 5: Submit Emend PR 08 and stop**

```bash
gh pr create --base main \
  --title "test: characterize Track Changes structural compatibility" \
  --body "Refs #36. Adds real-Obsidian compatibility evidence, durable bare/Emend fixtures, and Stage 61 while keeping structural Operations fail-closed. Includes exact accept/reject and presentation evidence, companion version/commit and any separate companion PR gate, final-head gates, runtime provenance, and honest platform/provider limits."
```

Do not merge, comment externally on Issue #36 before merge, bump versions, tag, publish, or start PR 09. After the human merges, post the warranted scoped Issue #36 update and leave the issue open. Stop at the human gate.

## Explicitly Outside Scope

- PR 09 table Operations or any structural writer enablement.
- PR 10 list/blockquote writer enablement; their fixtures here are compatibility-only.
- PR 11 pending-card merging or follow-up editing inside existing tokens.
- An Emend-owned renderer, preview, diff, Apply/Reject UI, missing-plugin installer, bundling, or auto-install.
- Companion parser/source-operation changes unless a separately approved scope decision says a byte defect requires them.
- A companion fork or external publication without explicit approval.
- General fenced-code tracking, universal CommonMark support, configurable retries, images, or Mermaid.
- Real-provider claims, unexercised CRLF success, other platforms, physical input, screen readers, or unexercised companion/Obsidian versions.
- Version bumps, `CHANGELOG.md`, tags, releases, workflows, or automatic merges.
