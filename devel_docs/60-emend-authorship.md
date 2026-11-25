# Stage 60: Emend authorship

## Status, base, and scope

Implemented on `feature/2.11-pr07-emend-authorship` from merged PR 06 base `f16633932ebf871b1e7c43ffc97b5915247933b1`. The production, test, and real-Obsidian evidence head is `1ebabe04b04f15e574d4d1e5b2f36e6dd9cc5c59`; Task 4 adds documentation only. This is current 2.11 scope for [#44](https://github.com/chliu1990/obsidian-emend/issues/44), not release metadata or a claim that the PR has merged.

| Commit | Subject | Scope |
| --- | --- | --- |
| `3d02f89` | `docs: plan Emend edit authorship` | Focused parser, renderer, emission, preservation, verification, and documentation plan. |
| `52566a9` | `feat: parse attributed CriticMarkup` | Supported attributed parsing, metadata projections, delimiter classification, and the fixed-author renderer. |
| `7beeaf9` | `fix: reject Emend highlight rendering` | Runtime rejection of highlight emission in addition to the compile-time token-type exclusion. |
| `1ebabe0` | `feat: attribute new edits to Emend` | Shared-renderer use in every compiler and guard emission path, with exact-output and writer-parity coverage. |

Every newly compiled insertion, deletion, substitution, and comment now carries exactly `author="Emend"`. Supported bare and attributed source tokens are parsed without losing their raw bytes, and every supported pre-existing token must survive exactly and in order. New output contains no `date=`, configurable author, comment discussions or replies, or new highlight tokens. The separate AI-text token kind is not added.

Operations, provider prompts and schemas, target capture, request identity, persistence, correction policy, strict in-token Selection rejection, freshness, writers, native undo, and the single Track Changes review surface retain their existing contracts. No companion-plugin change or pending-card merging is included. Historical Stages [37](37-minimal-edit-ranges.md), [38](38-markdown-edit-safeguards.md), [56](56-edit-freshness.md), [57](57-markdown-scanner.md), and [59](59-actionable-in-token-rejection.md) remain unchanged.

## Fixed output and preservation contract

`createEmendCriticMarkupToken` derives delimiters from the existing token table and returns only these forms:

| New token | Exact renderer output |
| --- | --- |
| Insertion | `{author="Emend"++new++}` |
| Deletion | `{author="Emend"--old--}` |
| Substitution | `{author="Emend"~~old~>new~~}` |
| Comment | `{author="Emend">>note<<}` |

`EmendMarkupTokenType` excludes `highlight` at the type level, and the renderer also rejects a runtime highlight request with `Unsupported CriticMarkup token type.` Existing attributed highlights remain supported parser input and are preserved like other valid original tokens.

The parser continues to support insertion, deletion, substitution, comment, and highlight in bare form and in the supported attributed form. Attribute bytes are included in `token.raw` and `token.start`/`token.end`, but excluded from `content`, `oldText`, and `newText`. Reject views therefore match their bare equivalents: insertions and comments disappear, deletions and highlights unwrap, and substitutions restore `oldText`.

`matchOriginalTokens` remains unchanged and compares complete raw token strings. Equal normalized metadata, a matching reject view, or an equivalent visible result cannot authorize rewriting or dropping an original token. Change counts include only new non-comment tokens. Source-valid `[]` and unchanged replacements remain successful no-ops without new markup, freshness reads, or writes.

## Supported Track Changes 2.3.0 attribute syntax

The optional metadata interface is:

```ts
export interface MarkupTokenMetadata {
	raw: string;
	attributes: Readonly<Record<string, string>>;
	author?: string;
	date?: string;
}

// On MarkupToken; absent for bare tokens.
metadata?: MarkupTokenMetadata;
```

The supported grammar is `key="value"` immediately after `{`:

- Keys start with an ASCII letter, followed by ASCII letters, digits, `_`, or `-`.
- The separator is exactly `="`; whitespace around `=` is not accepted.
- Values end at `"` and cannot contain `{`, `}`, or LF. A lone CR remains supported and byte-exact.
- Multiple attributes require spaces or tabs, with optional trailing spaces or tabs before the existing token marker.
- Attribute keys normalize to lowercase. Values are trimmed, empty values are omitted from parsed attributes, and the first nonempty duplicate value wins.
- `metadata.raw` retains the exact source attribute bytes, including original key case, empty values, duplicate attributes, value whitespace, and trailing separator whitespace.
- Attribute storage uses a null-prototype object and own-property-safe writes. Leading-underscore keys such as `__proto__` remain malformed under the explicit key grammar; valid prototype-related keys such as `constructor` and `hasOwnProperty` are harmless own data.

| Input class | Result |
| --- | --- |
| Bare token | Existing behavior; no `metadata` property. |
| Valid attributed insertion, deletion, substitution, comment, or highlight | Parsed with exact token/metadata raw strings and offsets. |
| Multiple, mixed-case, duplicate, empty, or whitespace-padded attributes | Deterministic normalized projection plus byte-exact raw preservation. |
| Digit- or underscore-leading key, whitespace around `=`, missing/unterminated quote, forbidden value byte, or whitespace without a valid attribute | No manufactured metadata; existing ordinary-text/closer scanning remains authoritative. |
| Valid attributed opener without its closer | Existing `Unclosed <type> at offset …` category. |
| Nested attributed opener | Rejected as nested CriticMarkup. |
| Valid attributed opener in an Operation string field | Rejected as `invalid-operation`, like bare delimiters and `~>`. |

Parser diagnostics retain token categories and offsets without exposing attribute keys or values. `containsCriticMarkupDelimiter` uses the same opener matcher as parsing and nested-delimiter detection, while retaining the existing closer and `~>` checks. Ordinary braces or prose such as `author="Alice"` are not delimiters. No accept-view production API was added.

## Emission and guard paths

| Module | Current ownership and behavior |
| --- | --- |
| `src/critic-markup.ts` | Shared bare/attributed opener parsing, exact metadata/raw ranges, delimiter classification, fixed `Emend` renderer, reject projection, and raw original-token matching. |
| `src/replacement-diff.ts` | Pure insertion, pure deletion, and substitution emission use the shared renderer. Minimization, LCS choices, work limits, whole-target fallbacks, determinism, and exact reconstruction checks are unchanged. |
| `src/operation-edit-strategy.ts` | Direct insert, remove, and comment Operations use the shared renderer; replacements still use `createReplacementCompiler`. `containsCriticMarkupDelimiter` rejects valid attributed opener injection as well as existing bare delimiters. |
| `src/markdown-edit-guards.ts` | Insertion, substitution, and comment payload wrappers plus all four fallback table projections use the shared renderer. Payload starts derive from rendered wrapper length, payload length, and the fixed closer. |

Accepted-text computation, table signatures, scanner projections, payload and affected-row checks, first-violation ordering, sanitized diagnostics, Operation ordering, summaries, and change counts are unchanged. Full-note Edit still uses only guarded `vault.modify`; Selection Edit and Modify Selection still use only native `editor.replaceRange` on captured offsets after the existing freshness and composed-note checks.

## Design decisions and alternatives

- **One shared renderer instead of per-emitter attribute literals:** all compiler and guard projections derive identical bytes from the existing delimiter table. This avoids drift in attribution, closers, payload offsets, and table fallbacks without adding another parser or writer stack.
- **Raw source equality instead of normalized metadata matching:** normalized attributes are a parsing projection only. Treating metadata-equivalent tokens as interchangeable would permit silent loss of original author, date, duplicate, empty-value, case, or whitespace bytes.
- **Fixed `Emend` instead of configurable identity or timestamps:** the requested deterministic attribution needs no new setting, provider field, date policy, or privacy surface. Existing dates remain preserved source data; new dates are not generated.
- **No accept-view API, comment-discussion model, companion change, or pending-card merger:** the existing reject projection and Track Changes commands are sufficient for this scoped behavior. Follow-up editing still requires resolving the pending card and making a fresh Selection.

## Exact mixed-operation bytes and writer parity

For original `Alpha beta gamma delta`, the deterministic Operations insert `!` after `Alpha`, remove `beta`, replace `gamma` with `Gamma`, and comment `Review.` on `delta`. The exact annotated result, with no trailing newline and no `date=`, is:

```text
Alpha{author="Emend"++!++} {author="Emend"--beta--} {author="Emend"~~gamma~>Gamma~~} delta{author="Emend">>Review.<<}
```

The concise result counts three tracked changes. The comment retains its summary item but contributes zero text changes. Real Track Changes 2.3.0 displayed three suggestion cards and one standalone comment, each labelled `Emend`, with no new date label.

| Boundary | Full-note Edit | Selection Edit |
| --- | --- | --- |
| Writer | Exactly one guarded `vault.modify`; zero native replacements. | Exactly one native `replaceRange` at captured offsets 18–40; zero guarded vault writes. |
| Annotated target bytes | Exact mixed-operation string above. | Same exact mixed-operation string. |
| Outside bytes | Complete captured target only. | Prefix/suffix whitespace, café, emoji, decomposed `e\u0301`, tab, and final LF preserved exactly. |
| Undo/review | Track Changes owns Accept/Reject review. | Native undo restored the complete pre-edit document; redo restored the exact attributed document. Track Changes review also matched. |

The Selection document was exactly:

```json
"Prefix café 😀  \n\nAlpha beta gamma delta\n\nSuffix e\u0301\t stays.\n"
```

On reset copies, actual `track-changes:accept-change-at-cursor`, `track-changes:reject-change-at-cursor`, and `track-changes:delete-comment-at-cursor` commands produced these exact target bytes after editor/disk updates:

| Resolution | Exact bytes, with no trailing newline |
| --- | --- |
| Accept suggestions and delete comment | `Alpha!  Gamma delta` |
| Reject suggestions and delete comment | `Alpha beta gamma delta` |

No author metadata, CriticMarkup delimiters, or comment bytes remained. Comments were deleted; Accept/Reject-comment behavior is not claimed.

Both `[]` and an unchanged replacement returned `No changes were needed.` with exact provider usage 15 total / 10 prompt / 5 completion, one request, unchanged source bytes, and zero target freshness reads or writes.

## Bare and other-author preservation matrix

A follow-up outside existing tokens produced this exact annotated fixture; `\n` denotes its final LF:

```text
Bare {++old++} Other {author="Legacy" date="2020-01-02"~~old~>new~~} {author="Emend"~~tail~>end~~} café 😀\n
```

The bare token, other-author token and date, Unicode, and all original raw bytes survived; only the new substitution gained `Emend`. Independent real-command resolutions produced:

| Case | Exact final bytes (`\n` denotes final LF) |
| --- | --- |
| Bare accept | `Bare old Other {author="Legacy" date="2020-01-02"~~old~>new~~} {author="Emend"~~tail~>end~~} café 😀\n` |
| Bare reject | `Bare  Other {author="Legacy" date="2020-01-02"~~old~>new~~} {author="Emend"~~tail~>end~~} café 😀\n` |
| Other-author accept | `Bare {++old++} Other new {author="Emend"~~tail~>end~~} café 😀\n` |
| Other-author reject | `Bare {++old++} Other old {author="Emend"~~tail~>end~~} café 😀\n` |
| New Emend accept | `Bare {++old++} Other {author="Legacy" date="2020-01-02"~~old~>new~~} end café 😀\n` |
| New Emend reject | `Bare {++old++} Other {author="Legacy" date="2020-01-02"~~old~>new~~} tail café 😀\n` |

Unit and integration coverage additionally preserves an attributed highlight and prior `Emend` tokens across repeated edits. Adjacent and enclosing Selection edits preserve complete attributed raw-token and metadata bytes. Strict Selection inside attributed insertion, deletion, either substitution side, comment, highlight, an attribute key, or an attribute value retains terminal `in-token-selection` behavior after composed rejection: one initial request, no correction or continuation, no target freshness read or write, unchanged bytes, and the existing actionable recovery message. An exact complete raw-token Selection is not strict. Delimiter-fragment source validation remains authoritative even for `[]` and unchanged replacements.

## Genuine RED/GREEN and static evidence

New parser/renderer and emitter tests ran against the then-current production before implementation. Passing strict-rejection, no-op, malformed-source, and behavior-equivalent guard cases at Task 2 RED were characterization controls, not counted as new RED evidence.

| Task or gate | Exact command | Observed result |
| --- | --- | --- |
| Task 1 initial RED | `npx vitest run tests/critic-markup.test.ts` | Exit 1; **49 failed / 85 passed** (134 total). Attributed cases failed on old parsing and missing renderer/classifier behavior. Vitest transformed and ran the suite instead of producing the anticipated load-time missing-export failure. |
| Task 1 focused GREEN | Same command | **134/134 tests passed**. |
| Task 1 full/static | `npm test`; `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check` | **57 files / 2,167 tests passed**; TypeScript, ESLint, and diff checks passed. No build or runtime verification was claimed for this parser-only task. |
| Review-fix RED | `npx vitest run tests/critic-markup.test.ts` | Exit 1; **1 failed / 134 passed** (135 total). Runtime highlight emission did not throw before `7beeaf9`. |
| Review-fix GREEN | Same command | **135/135 tests passed**. TypeScript and final ESLint/diff checks also passed; the full suite was not rerun for the one-line focused fix. |
| Task 2 RED | `npx vitest run tests/replacement-diff.test.ts tests/operation-edit-strategy.test.ts tests/markdown-edit-guards.test.ts tests/request-coordinator.test.ts tests/selection-editor.test.ts tests/request-isolation.test.ts tests/edit-response.test.ts tests/main.test.ts tests/chat-view-public.test.ts` | Exit 1; **9 files failed, 98 tests failed / 554 passed** (652 total). Exact output, attributed-injection, shared-renderer spy, parity, and metadata-byte expectations failed before emitter migration. |
| Task 2 focused GREEN | Same command | **9 files / 652 tests passed**. |
| Task 2 final full/static/build | `npm test`; `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check`; `npm run build` | **57 files / 2,198 tests passed**; TypeScript, ESLint, diff checks, and production build passed. |

Coverage includes exact attributed output for separated LCS hunks, backtick and work-limit fallbacks, missing `Intl.Segmenter`, Unicode, multiline and CRLF strings, repeated calls, and accept/reject reconstruction. Direct Operations, payload diagnostics, unmatched backticks, closing-fence newline rules, safe table cells, attributed fragmentation and backslash parity, escaped pipes, row signatures, no-ops, correction boundaries, writer confinement, concise persistence, and raw-source preservation remain covered.

## Independent implementation and evidence reviews

| Gate | Result |
| --- | --- |
| Task 1 parser/renderer spec-compliance and quality reviews | Clean PASS after the focused runtime-highlight fix; grammar, raw offsets, duplicate/empty handling, nesting, bare behavior, and renderer boundaries checked. |
| Task 2 spec-compliance, quality, and write/security reviews | Clean PASS; all emission paths, attributed injection, payload offsets, table projections, raw matching, no-op/correction boundaries, writer confinement, and private candidate handling checked. |
| Task 3 runtime and write/privacy reviews | Clean PASS; visible attribution, exact accept/reject and comment-deletion bytes, preservation, native undo, writer counts, persistence, and bundle identity checked. |

These results concern the production/test implementation and runtime evidence. No independent documentation-review result is claimed in this stage record.

## Real-Obsidian loopback verification

Task 3 built and exercised exact production head `1ebabe04b04f15e574d4d1e5b2f36e6dd9cc5c59`. Every green runtime summary records root and loaded `main.js` SHA-256 `6e4d03e46914decbd694b7609edac33b8985aa7f664142f3e8c520496a8031db`, `loadedBundleMatchedRoot: true`, and the exact production head. A final disk hash of the root and loaded vault copies matched the same value.

The executed commands and preserved results were:

| Exact command | Passed scenarios | Assertions | Failures |
| --- | ---: | ---: | --- |
| `node test_vault/emend-selection-chat-verify/verify.mjs --emend-authorship` | 5 | 114 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --in-token-rejection` | 5 | 62 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --stabilization` | 6 | 55 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --modification-controller` | 6 | 73 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner` | 10 | 318 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness` | 24 | 227 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow` | 5 | 95 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --sessions` | 9 | 156 | 0 |
| `node test_vault/emend-selection-chat-verify/verify.mjs` | 28 | 589 | 0 |
| **Total** | **98** | **1,689** | **0** |

`npm run build` passed before these commands. The focused group exercised actual Full-note and Selection SSE requests, writer calls, note bytes, review labels and commands, native undo/redo, strict rejection, no-ops, persistence, and screenshots. Inherited groups re-ran their stabilization, controller, scanner, freshness, target, session, lock, abort, stale-source, persistence-privacy, and writer/undo checks against the same bundle.

The privacy audit inspected focused request JSON, actual note bytes, saved schema-3 aggregates, and screenshots. A final local scan covered 41 saved-chat JSON files and 125 request logs covering 151 requests, with no dummy credential, rejected candidate/reasoning, source-snapshot, correction-diagnostic, Operations-marker, authorization, or header leakage. The default 15-thread persistence matrix and edit-freshness 21-file saved-chat audit also passed.

### Harness control

`node test_vault/emend-selection-chat-verify/verify.mjs --emend-authorship-failing-control` exited **1**, as required, with zero passed and one intentionally failed scenario. This was a harness-only failing-assertion control with matching bundle identities, not a product failure, and is excluded from the 98-scenario green matrix.

### Runtime environment and limits

Evidence used Linux `6.12.117+deb13-amd64` x86_64, Node **20.19.2**, the official Obsidian **1.15.0** AppImage, separately installed Track Changes **2.3.0**, isolated Xvfb `:101`, CDP `19224`, and loopback OpenAI-compatible SSE/CORS at `127.0.0.1:18766`. Notes and Operations were synthetic and the SecretStorage credential was a dummy.

No real provider, account, paid call, private note, external network, or real credential was used. These results do not establish macOS, Windows, mobile, physical OS-level input, screen-reader/assistive-technology, other Obsidian or companion versions, or real-provider behavior. CDP-dispatched input is not physical keyboard or pointer coverage. Real CRLF edit success was not exercised; CRLF runtime coverage was limited to inherited fail-closed freshness cases. Bundle identity proves that the harness loaded the root bundle, not behavior in an unexercised environment.

This evidence belongs to the production code head above. Later documentation commits do not change that provenance, and final documentation-head gate or hash evidence belongs in the PR body rather than recursively in this record.

## Issue disposition and remaining limitations

Issue **#44 may close only when this PR merges**. Until then, fixed `Emend` attribution is implemented current 2.11 scope, not released or merged behavior.

New output intentionally has no timestamp or author setting. Emend comments remain standalone review comments without discussions or replies. Track Changes remains separate and is the only Accept/Reject review surface; comments are deleted through its command rather than accepted or rejected. No companion-plugin change, automatic installation, second review UI, or pending-card follow-up merging is included. Issue **#37 remains deferred** for deterministic pending-card addressing and net-suggestion merging. Existing strict in-token rejection, one-correction policy, freshness guards, writer separation, and native Selection undo remain unchanged.
