# Emend 2.11.0 PR 07 Emend Authorship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse and preserve supported attributed CriticMarkup while emitting the fixed author `Emend` on every newly created insertion, deletion, substitution, and comment token in Full-note and Selection editing.

**Architecture:** Extend the existing CriticMarkup parser with Track Changes-compatible optional attribute metadata and add one fixed-author token renderer shared by Operations compilation, replacement minimization, and guard projections. Preserve exact raw source tokens, reject-view equality, change counting, existing writers, freshness, correction behavior, and native Selection replacement without adding pending-card merging or another review surface.

**Tech Stack:** Strict TypeScript, existing Operations/CriticMarkup compiler and Markdown guards, Vitest with Obsidian mocks and the public chat-view fixture, ESLint, esbuild, ignored real-Obsidian Linux/Xvfb loopback verification, and separately installed Track Changes 2.3.0. No new dependency.

**Spec:** Approved global plan at `/home/chang/.kimi-code/sessions/wd_obsidian-emend_61e31fc4b91e/session_7fbcbcbe-a02f-4964-b3ae-36c56c50d44f/agents/main/plans/captain-marvel-aqualad-jericho.md`, specifically Global Constraints, Product Decisions > Author-enabled modification, PR 07, and the PR workflow; [Issue #44](https://github.com/chliu1990/obsidian-emend/issues/44); `AGENTS.md`; `IMPLEMENTATION_PLAN.md`; `docs/guides/editing-and-review.md`; `ROADMAP.md`; Stages 37, 38, 56, 57, and 59; current source at base `f16633932ebf871b1e7c43ffc97b5915247933b1`.

## Global Constraints

- Work only on `feature/2.11-pr07-emend-authorship` in the approved worktree based at `f16633932ebf871b1e7c43ffc97b5915247933b1`.
- Emit exactly `author="Emend"` on every new insertion, deletion, substitution, and comment token.
- Do not emit dates, add an author setting, add comment discussions/replies, or change provider prompts or Operation schemas.
- Existing bare CriticMarkup remains valid. Preserve every supported pre-existing token byte-for-byte and in order.
- Support the existing five parser token kinds with Track Changes 2.3.0 attribute syntax; do not add the separate AI-text token kind.
- Operations remain the only model-facing edit protocol. Resolve exact original anchors atomically and reject ambiguity, overlap, malformed structure, delimiter injection, and stale state.
- Full-note Edit alone retains guarded `vault.modify`; Selection Edit and Modify Selection retain only native `editor.replaceRange` on the captured range.
- Do not change `edit-freshness.ts`, writer implementations, writer ordering, request identity, persistence, or correction-round policy.
- Track Changes remains separate and is the only Accept/Reject surface. Add no Emend diff, Apply/Reject UI, bundling, or automatic installation.
- Strict in-token Selection behavior remains terminal after composed-markup rejection; valid no-op behavior and every other correction path remain unchanged.
- Pending-card merging belongs to PR 11. Do not make whole-card follow-up Operations valid or implicitly accept/reject existing cards.
- PR 08 companion work, structural table/list/blockquote editing, images, Mermaid, configurable retries, and partial application are out of scope.
- Use focused modules and existing TypeScript style. Add no runtime dependency or second parser/provider/writer stack.
- Update current canonical documentation and add Stage 60. Do not alter historical stage records.
- Do not change versions, `CHANGELOG.md`, tags, releases, workflows, or Community Directory state.
- Runtime evidence is limited to synthetic notes, loopback SSE/CORS, dummy credentials, and ignored `test_vault/` artifacts.
- Submit only PR 07 and stop at the human gate; do not merge or start PR 08 automatically.

## Review Focus

- **Malformed, duplicate, empty, or mixed-case attributes:** supported metadata must parse deterministically without prototype-key side effects, while raw bytes remain authoritative; Task 1 parser tests pin this.
- **Attributed delimiter injection and nesting:** Operation strings and nested attributed openers must fail closed just like bare delimiters; Tasks 1 and 2 own classifier and Operations tests.
- **Attributed guard projections:** payload offsets and affected-table-row original/annotated/accept/reject signatures must use the actual attributed wrapper; Task 2 owns backtick, fence, escaped-pipe, and fallback-projection tests.
- **Follow-up and strict Selection boundaries:** bare and other-author tokens must survive later edits, while attributed strict in-token Selection rejection retains one request and no write; Task 2 owns parity and preservation tests.
- **Real companion behavior:** new cards must display `Emend`, change tokens must resolve to exact accept/reject bytes, comments must delete exactly, and Selection native undo/redo must restore exact documents; Task 3 owns real-Obsidian verification.

---

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/critic-markup.ts` | Parse optional attributes, expose metadata, classify delimiters, render fixed-author new tokens, preserve reject/count behavior |
| `src/replacement-diff.ts` | Route minimized insertion/deletion/substitution emission through the fixed renderer |
| `src/operation-edit-strategy.ts` | Route all four Operation kinds through the fixed renderer and reject attributed delimiter injection |
| `src/markdown-edit-guards.ts` | Keep payload wrappers and fallback table projections identical to actual attributed compilation |
| `tests/critic-markup.test.ts` | Bare/attributed parsing, metadata, reject views, counting, preservation, renderer, and malformed/nested cases |
| `tests/replacement-diff.test.ts` | Exact attributed minimal/fallback output and accept/reject reconstruction |
| `tests/operation-edit-strategy.test.ts` | Four-kind emission, delimiter rejection, counts, no-ops, and Full-note/Selection parity |
| `tests/markdown-edit-guards.test.ts` | Attributed payload and table guard projections |
| Coordinator/view tests | Exact writer handoff, follow-up preservation, strict in-token behavior, and unchanged privacy/writer contracts |
| `test_vault/emend-selection-chat-verify/` | Ignored real-Obsidian scenarios and evidence only |
| `AGENTS.md`, editing guide, architecture contract, roadmap | Current behavior and ownership |
| `devel_docs/60-emend-authorship.md` | New Stage 60 design, evidence, reviews, and limits |

### Task 0: Save the plan and confirm the base

**Files:**
- Create: `docs/superpowers/plans/2026-11-25-emend-2-11-pr07-emend-authorship.md`

**Interfaces:**
- Consumes: Approved PR 07 scope and current base `f16633932ebf871b1e7c43ffc97b5915247933b1`.
- Produces: One reviewed implementation plan and one SDD todo per subsequent task.

- [ ] **Step 1: Confirm the workspace and scope**

Confirm the branch is not `main`, the base matches the approved merged main, tracked files are clean, Stage 60 does not already exist, and the baseline suite is green before editing.

- [ ] **Step 2: Save and independently review the plan**

Review the exact renderer/parser interface, attributed grammar, emission-path inventory, guard projections, Full-note/Selection parity, exact Track Changes bytes, native undo, and PR 08/PR 11 exclusions. Resolve every material builder-review finding before implementation.

- [ ] **Step 3: Commit only the plan**

```bash
git add docs/superpowers/plans/2026-11-25-emend-2-11-pr07-emend-authorship.md
git commit -m "docs: plan Emend edit authorship"
```

### Task 1: Parse attributed tokens and add the fixed-author renderer

**Files:**
- Modify: `src/critic-markup.ts:3-181`
- Test: `tests/critic-markup.test.ts`

**Interfaces:**
- Consumes: Existing `MarkupTokenType`, `MarkupToken`, `parseCriticMarkup`, `prepareCriticMarkupEdit`, and `toRejectView`.
- Produces:

```ts
export interface MarkupTokenMetadata {
	raw: string;
	attributes: Readonly<Record<string, string>>;
	author?: string;
	date?: string;
}

// Added to MarkupToken; absent for bare tokens.
metadata?: MarkupTokenMetadata;

export type EmendMarkupTokenType = Exclude<MarkupTokenType, 'highlight'>;

export function createEmendCriticMarkupToken(
	type: EmendMarkupTokenType,
	content: string,
): string;

export function containsCriticMarkupDelimiter(text: string): boolean;
```

- [ ] **Step 1: Write failing parser and renderer tests**

Keep every existing bare-token test unchanged. Add attributed insertion, deletion, substitution, comment, and highlight cases using the Track Changes form, for example:

```ts
expect(parseCriticMarkup('a{author="Alice"++new++}b')).toEqual([
	{
		type: 'insertion',
		raw: '{author="Alice"++new++}',
		content: 'new',
		start: 1,
		end: 24,
		metadata: {
			raw: 'author="Alice"',
			attributes: { author: 'Alice' },
			author: 'Alice',
		},
	},
]);
```

Add a multiple-attribute token with trailing whitespace before the marker:

```text
{author=" Alice " date="2026-11-25" reviewer="A B" ++new++}
```

Assert exact `raw`, `content`, `start`/`end`, `metadata.raw`, trimmed attribute values, and `author`/`date`. Assert mixed-case keys normalize to lowercase, the first nonempty duplicate wins, empty values are omitted from parsed attributes but retained in `raw`, and keys such as `__proto__` become harmless own data rather than mutating prototypes. Add a lone-CR value fixture and assert exact raw preservation to match Track Changes 2.3.0.

Pin a malformed-attribute matrix: a key beginning with a digit or underscore, whitespace around `=`, missing or unterminated quotes, `"`, `{`, `}`, or LF inside a value, and whitespace with no valid attribute before a token marker must not manufacture metadata. Each malformed form retains the existing bare-token/closer scanning result: assert no token and exact ordinary-text offsets where no closer is encountered, or the existing `Unexpected CriticMarkup closing delimiter at offset …` error where that closer is encountered. A syntactically valid attributed opener without its closer throws the existing `Unclosed <type> at offset …` category. Diagnostics contain offsets and token categories only, never attribute keys or values.

- [ ] **Step 2: Add failing projection, preservation, and renderer tests**

Pin the following:

- Attributed reject views equal their bare equivalents; comments disappear, insertions disappear, deletions/highlights unwrap, and substitutions restore `oldText`.
- `prepareCriticMarkupEdit` preserves bare and attributed original tokens exactly and counts only new non-comment tokens.
- Rewriting or dropping pre-existing attribution is rejected even when reject views match.
- Nested attributed openers and unclosed attributed tokens reject.
- Legacy comment-prefix text remains unchanged comment content.
- The renderer returns exactly:

```text
{author="Emend"++new++}
{author="Emend"--old--}
{author="Emend"~~old~>new~~}
{author="Emend">>note<<}
```

Assert no `date=` appears and the renderer’s type parameter excludes `highlight`.
Assert `containsCriticMarkupDelimiter` recognizes every existing bare delimiter, `~>`, and valid attributed openers, but not ordinary braces or prose such as `author="Alice"`.

- [ ] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/critic-markup.test.ts
```

Expected: the suite fails at load time because the new renderer/classifier exports do not yet exist. If the implementer separately adds explicit runtime stubs to isolate assertion failures, record that as a distinct RED cycle; do not claim the initial missing-export RED proves the bare cases still run.

- [ ] **Step 4: Implement the smallest parser extension**

Recognize the Track Changes 2.3.0 attribute grammar immediately after `{`:

```text
key="value"
```

Keys start with an ASCII letter followed by letters, digits, `_`, or `-`. Match Track Changes 2.3.0 exactly: values exclude `"`, `{`, `}`, and LF, while a lone CR remains supported. Multiple attributes use spaces/tabs, with optional trailing spaces/tabs before the existing token marker.

Keep bare openers unchanged. Include metadata in raw token ranges, not in `content`, `oldText`, or `newText`. Build attributes with own-property-safe creation, lowercase keys, trim values, omit empty values, and preserve the first parsed value for duplicate keys. Do not normalize `raw`.

Use the same opener matcher for nested-delimiter detection and `containsCriticMarkupDelimiter`; retain the existing closer and `~>` checks. Do not add an accept-view production API or change `matchOriginalTokens`.

Implement `createEmendCriticMarkupToken` solely from the existing delimiter table and fixed `Emend` value.

- [ ] **Step 5: Run GREEN and regression checks**

Run:

```bash
npx vitest run tests/critic-markup.test.ts
npm test
npx tsc -noEmit -skipLibCheck
npm run lint
git diff --check
```

Expected: all pass; no emitted output changes yet because the renderer has no production callers.

- [ ] **Step 6: Review and commit**

Require independent spec-compliance and quality review of grammar compatibility, raw offsets, duplicate/empty-key behavior, nesting, and unchanged bare behavior. Then:

```bash
git add src/critic-markup.ts tests/critic-markup.test.ts
git commit -m "feat: parse attributed CriticMarkup"
```

### Task 2: Attribute every new token and preserve all edit guards

**Files:**
- Modify: `src/replacement-diff.ts:19-202`
- Modify: `src/operation-edit-strategy.ts:21-33,150-207,418-445`
- Modify: `src/markdown-edit-guards.ts:195-240,291-341`
- Test: `tests/replacement-diff.test.ts`
- Test: `tests/operation-edit-strategy.test.ts`
- Test: `tests/markdown-edit-guards.test.ts`
- Test: `tests/request-coordinator.test.ts`
- Test: `tests/selection-editor.test.ts`
- Test: `tests/request-isolation.test.ts`
- Test: `tests/edit-response.test.ts`
- Test: `tests/main.test.ts`
- Test: `tests/chat-view-public.test.ts`

**Interfaces:**
- Consumes: `createEmendCriticMarkupToken` and `containsCriticMarkupDelimiter` from Task 1.
- Produces: Unchanged public signatures for `createReplacementCompiler`, `compileEditOperations`, `operationEditStrategy`, both coordinators, and both writers. All newly compiled non-highlight tokens carry `author="Emend"`.

- [ ] **Step 1: Write failing exact-output tests for every emission path**

Update compiler-derived expected strings to attributed forms. Do not mechanically rewrite hand-built bare source fixtures: bare tokens in parser, writer, scanner, and pending-markup fixtures remain valid pre-existing input.

Pin replacement minimization for:

- pure insertion and deletion;
- substitutions and separated LCS hunks;
- backtick whole-target fallback;
- missing `Intl.Segmenter` and work-limit fallbacks;
- Unicode, CRLF, and multiline content;
- deterministic repeated calls;
- exact accept/reject reconstruction through the existing test helper.

Pin direct Operations for all four kinds and mixed operations. For original `Alpha beta gamma delta`, compile:

```ts
[
	{ type: 'insert', anchor: 'Alpha', position: 'after', text: '!' },
	{ type: 'remove', target: 'beta' },
	{ type: 'replace', target: 'gamma', replacement: 'Gamma' },
	{ type: 'comment', target: 'delta', comment: 'Review.' },
]
```

Expected annotated Markdown:

```text
Alpha{author="Emend"++!++} {author="Emend"--beta--} {author="Emend"~~gamma~>Gamma~~} delta{author="Emend">>Review.<<}
```

Expected `changeCount` is `3`; the comment retains its summary item and contributes zero text changes. `[]` and identical replacements remain byte-identical no-ops with no new markup.

- [ ] **Step 2: Add failing delimiter and guard tests**

Add valid attributed opener injection cases through every applicable Operation string field, asserting `invalid-operation` and no source-content leakage. Keep all existing bare delimiter cases. Add a malformed attributed source case through the public Selection coordinator, asserting `EditSourceValidationError`, no attribute keys/values in the public message, one request, no correction, no freshness read, and no write.

Add a partial module spy for `createEmendCriticMarkupToken` without changing its real implementation. Before emitter migration, write the final positive call-count expectations for insertion, substitution, and comment payload wrappers and all four fallback table projections. Run those unchanged tests against the unmigrated guard and observe failures because it makes no renderer calls; keep the same tests through GREEN. This is the genuine RED seam for shared-renderer use; do not export private guard helpers.

Add guard behavior cases proving:

- attributed insertion, replacement, and comment wrappers preserve payload balance checks and exact diagnostics;
- an unmatched payload backtick still reports the original operation/field/line;
- a closing fence still requires its trailing newline;
- safe table cell insert/remove/replace/comment Operations remain valid without `compiledText`, exercising fallback projections;
- actual attributed `compiledText` still catches minimized delimiter fragmentation and backslash-parity changes;
- escaped pipes, Unicode, CRLF, and original/annotated/accepted/rejected row signatures remain exact.

- [ ] **Step 3: Add failing Full-note/Selection parity and follow-up tests**

Run the same mixed four-Operation candidate through Full-note and a full-range Selection. Assert the Full-note writer receives the exact annotated string above and Selection receives that same string through one native `replaceRange(annotated, 0, original.length)`. Assert no guarded vault write for Selection and no native replacement for Full-note.

Add a follow-up fixture containing bare tokens, other-author attributed tokens, an attributed highlight, and plain editable text. Assert:

- the first edit preserves every pre-existing raw token and adds only `Emend` markup;
- a second edit preserves the first `Emend` tokens as well as every other-author/bare token;
- counts include only newly introduced non-comment tokens;
- unchanged replacements and `[]` perform no write;
- strict Selection inside attributed insertion, deletion, substitution old/new sides, comment, and highlight retains `in-token-selection`, one request, no correction, no freshness read, and no write;
- a Selection strictly inside an attribute key or value has the same terminal behavior, while an exact complete attributed raw-token Selection is not strict;
- attributed delimiter-fragment source validation takes precedence even for `[]` and unchanged replacements;
- adjacent and enclosing Selection edits preserve complete attributed raw token and metadata bytes.

Update only compiler-derived coordinator, public-view, main, request-isolation, and edit-response expectations. Keep hand-prepared bare writer fixtures unchanged to prove writers do not rewrite prepared content.

- [ ] **Step 4: Run RED before changing emitters**

Run:

```bash
npx vitest run tests/replacement-diff.test.ts tests/operation-edit-strategy.test.ts tests/markdown-edit-guards.test.ts tests/request-coordinator.test.ts tests/selection-editor.test.ts tests/request-isolation.test.ts tests/edit-response.test.ts tests/main.test.ts tests/chat-view-public.test.ts
```

Expected: exact-output, attributed-delimiter-injection, and shared-renderer spy tests fail because production still emits bare markup or does not call the renderer. Strict attributed-content boundaries and behavior-equivalent guard cases that already pass after Task 1 are passing characterization controls, not RED evidence; record their actual results honestly.

- [ ] **Step 5: Route every emitter through the shared renderer**

In `replacement-diff.ts`, replace all three branches of `emitEdit` with `createEmendCriticMarkupToken`. Do not change minimization, work limits, reconstruction checks, or the compiler signature.

In `operation-edit-strategy.ts`:

- use the renderer for insert, remove, and comment;
- leave replacement minimization to `createReplacementCompiler`;
- replace the local literal-only delimiter array check with `containsCriticMarkupDelimiter`;
- preserve range resolution, operation order, summaries, counts, correction behavior, and prompts.

In `markdown-edit-guards.ts`:

- construct insertion, substitution, and comment payload wrappers with the same renderer;
- derive `payloadStart` from the rendered wrapper, known payload length, and fixed closer length rather than searching for payload text or duplicating a hardcoded attribute prefix;
- use the renderer in `fallbackCompiledText`;
- do not change accepted-text computation, table signatures, scanner projections, violation ordering, or diagnostics.

Do not modify either writer, freshness, selection coordination, modification controller, persistence, or UI production code.

- [ ] **Step 6: Run GREEN and the complete local regression gate**

Run the RED command, then:

```bash
npm test
npx tsc -noEmit -skipLibCheck
npm run lint
git diff --check
```

Expected: all pass. Inspect the diff for any accidental rewriting of pre-existing bare fixtures or writer/freshness changes.

- [ ] **Step 7: Obtain independent implementation and write/security review**

Require spec-compliance and quality verdicts plus a focused write/security review. Review every new-token path, attributed injection, parser/raw-offset consistency, payload offsets, table projections, no-op semantics, correction boundaries, native writer confinement, and private candidate handling. Fix Critical/Important findings through the same implementer and rerun affected plus full gates.

- [ ] **Step 8: Commit**

```bash
git add src/critic-markup.ts src/replacement-diff.ts src/operation-edit-strategy.ts src/markdown-edit-guards.ts tests
git commit -m "feat: attribute new edits to Emend"
```

### Task 3: Verify real Track Changes attribution, exact bytes, and native undo

**Files:**
- Ignored only: `test_vault/emend-selection-chat-verify/verify.mjs`
- Ignored only: `test_vault/emend-selection-chat-verify/mock-provider.mjs`
- Ignored only: runtime notes, request/writer logs, screenshots, and evidence under `test_vault/emend-selection-chat-verify/`

**Interfaces:**
- Consumes: Exact attributed Operations output from Task 2 and the inherited PR 06 harness.
- Produces: Real-Obsidian evidence for author display, Full-note/Selection parity, Track Changes resolution, preservation, and native undo. No tracked harness artifact.

- [ ] **Step 1: Provision the inherited ignored harness**

Provision scripts from `/home/chang/Projects/obsidian-emend/.superpowers/worktrees/2-11-pr06-in-token-rejection/test_vault/emend-selection-chat-verify/` into this worktree’s ignored `test_vault/`, not the older root copy. Provision its required ignored Obsidian/Xvfb/CDP tools and separately installed Track Changes 2.3.0, with loopback OpenAI-compatible SSE/CORS, synthetic notes, and dummy SecretStorage credentials. Do not modify either source worktree’s ignored harness or commit any runtime file. Assert the loaded companion manifest version is exactly `2.3.0`.

Add a focused `--emend-authorship` scenario group and deterministic Operations. Update inherited expectations only where Emend newly emits markup; keep bare pre-existing fixtures bare.

- [ ] **Step 2: Verify Full-note attribution and exact resolution bytes**

Submit the mixed four-Operation candidate from Task 2 through real Full-note Edit. Assert one guarded vault write, zero native replacements, exact annotated bytes, no `date=`, and concise result count `3`.

Open the actual Track Changes review panel and assert every new suggestion and the comment displays author `Emend`, with no new date label. Use actual companion commands on reset copies:

- accepting insertion/deletion/substitution and deleting the standalone comment produces exactly `Alpha!  Gamma delta`;
- rejecting insertion/deletion/substitution and deleting the standalone comment produces exactly `Alpha beta gamma delta`;
- no `author=`, CriticMarkup delimiter, or comment bytes remain after those resolutions.

Use the exact companion command IDs `track-changes:accept-change-at-cursor`, `track-changes:reject-change-at-cursor`, and `track-changes:delete-comment-at-cursor`. Await the resulting editor/file update before comparing bytes. Comments use deletion; do not claim comments have Accept/Reject commands.

- [ ] **Step 3: Verify Selection parity and native undo/redo**

Submit the same Operations against the same complete Selection. Assert exactly one native replacement at captured offsets, zero guarded vault writes, identical attributed replacement bytes, unchanged outside-Selection Unicode/whitespace, and `Emend` labels in Track Changes.

Immediately after Emend’s write, use native editor undo and assert restoration of the complete pre-edit document; redo must restore the exact attributed document. On fresh reset copies, verify the same exact companion accept/reject and comment-deletion bytes as Full-note.

- [ ] **Step 4: Verify preservation, strict rejection, and valid no-op behavior**

Use synthetic notes containing bare and other-author attributed tokens. Assert a follow-up outside those tokens preserves every original raw byte, adds only `Emend` markup, and resolves both old and new cards to their exact independent accept/reject bytes.

For an attributed strict in-token Selection, assert the existing exact guidance, one SSE request, no continuation, no target freshness read or write, unchanged bytes, and recovered controls. For `[]` and unchanged replacement controls, assert ordinary no-op results with no write.

- [ ] **Step 5: Run focused and inherited runtime groups**

Build the exact production code head and run:

```bash
npm run build
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

Require zero failures and matching root/loaded bundle SHA-256 values. Run one separate harness-only failing-assertion control and require nonzero exit status; do not describe it as a product failure.

- [ ] **Step 6: Audit evidence and independent runtime review**

Inspect actual request bodies, note bytes, review labels, command logs, writer calls, undo/redo logs, saved chats, and screenshots. Require no credentials, raw rejected candidates, correction diagnostics, or source snapshots in ready persistence.

Obtain independent runtime/write review of exact accept/reject bytes, comment deletion, native Selection undo, writer counts, and preservation. Record only exercised Linux/Xvfb, Obsidian, Track Changes, CDP-input, loopback, and dummy-credential evidence. Claim no real provider, paid call, other platform, physical input, screen reader, other companion version, or real CRLF success.

Commit no harness, vault, bundle, log, screenshot, or evidence file.

### Task 4: Update canonical documentation and add Stage 60

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/guides/editing-and-review.md`
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `ROADMAP.md`
- Create: `devel_docs/60-emend-authorship.md`

**Interfaces:**
- Consumes: Task 1/2 behavior and Task 3 actual evidence.
- Produces: Current canonical ownership and a new Stage 60 record without historical rewrites.

- [ ] **Step 1: Update contributor and architecture contracts**

In `AGENTS.md` and `IMPLEMENTATION_PLAN.md`, record that supported bare and attributed CriticMarkup is parsed and preserved, every new insertion/deletion/substitution/comment uses fixed `Emend`, new output has no dates or configurable author, and raw original-token matching remains authoritative. Retain all writer, freshness, correction, strict in-token, and pending-card exclusions.

Add Stage 60 to the numbered index and current status without changing Stages 37, 38, 56, 57, or 59.

- [ ] **Step 2: Update user-facing editing guidance**

Explain that Track Changes labels newly emitted suggestions and comments as `Emend`, existing bare/other-author markup is preserved, no date or author setting is added, and comment discussions remain outside scope. Link Stage 60 and keep Track Changes as the only review surface. Do not imply PR 08 companion changes or PR 11 follow-up merging.

Move #44 in `ROADMAP.md` to current 2.11 recently shipped scope only when implemented on this branch; do not call it released or merged before the human merge. Keep #37 and PR 08 work separate.

- [ ] **Step 3: Write Stage 60 from actual results**

Record base/scope, Track Changes 2.3.0 attribute syntax, metadata model, fixed renderer, affected emission/guard paths, alternatives, exact mixed-operation bytes, parity/preservation matrices, genuine RED/GREEN commands and results, reviews, runtime commands/results, bundle identity, and environment limits.

Distinguish production-code-head runtime evidence from later documentation commits. Do not recursively update Stage 60 for final-head evidence; final-head gates and hash evidence belong in the PR body.

- [ ] **Step 4: Run documentation checks and factual review**

Run relative-link/anchor and stale-claim audits over all changed documents, `git diff --check`, and the full test/lint/build gate. Obtain independent factual documentation review against current source and actual evidence.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/guides/editing-and-review.md IMPLEMENTATION_PLAN.md ROADMAP.md devel_docs/60-emend-authorship.md
git commit -m "docs: record Emend edit authorship"
```

### Task 5: Final gates, whole-PR review, and submission

**Files:**
- Review the complete base-to-head diff.
- Final-head evidence goes in the PR body, not another Stage 60 evidence rewrite.

- [ ] **Step 1: Run final focused and full gates**

Run focused parser/compiler/coordinator tests, then:

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

`npm ci` may be omitted only when dependencies are already installed and the lockfile is unchanged. Repeat the documentation link/anchor audit.

- [ ] **Step 2: Verify the exact submitted runtime head**

If any production or build-identity change occurred after Task 3, rebuild and rerun `--emend-authorship` plus every affected inherited group on the exact submitted head. Record final root/loaded bundle identity and runtime results in the PR body. Do not claim unexecuted final-head runtime coverage.

- [ ] **Step 3: Inspect scope and artifacts**

Confirm no generated bundle, vault content, evidence, credentials, version metadata, workflow, historical-stage, PR 08, or PR 11 changes are present. Confirm hand-built bare fixtures remain where they represent pre-existing markup.

- [ ] **Step 4: Obtain fresh whole-PR reviews**

Require independent spec-compliance, quality, write/security/privacy, public UX, and documentation/evidence reviews. Explicitly review all four token kinds, attributed delimiter injection, malformed metadata, guard fallback projections, counts, follow-up preservation, exact companion bytes, comment deletion, native Selection undo, and unchanged correction/freshness/writer contracts. Resolve every Critical/Important finding and rerun affected plus full gates.

- [ ] **Step 5: Submit PR 07 and stop**

Submit with `Closes #44` and final-head evidence in the PR body. Do not close #37, start PR 08, merge, tag, publish, or bump versions. Stop at the human gate.
