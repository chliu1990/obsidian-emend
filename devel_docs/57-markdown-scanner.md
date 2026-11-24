# Stage 57: Shared lossless Markdown scanner

## Status, base, and scope

Implemented on `feature/2.11-pr04-markdown-scanner` from merged main base `343f16ecb7c21cd6b181d61d27be1e76fd0764c1`. All unit, build, and real-Obsidian results in this record are from production code head `5cf2226b6db98aa04c0f9abb881307e94032e20e`. The later documentation-only commit is not silently treated as another tested code head.

This addresses [#79](https://github.com/chliu1990/obsidian-emend/issues/79) on the branch and is intended to close it on merge; the issue was not manually closed before merge. Markdown lexical and structural facts now live in one focused scanner module while Selection context and edit validation retain their separate policies and exact behavior.

| Commit | Subject | Scope |
| --- | --- | --- |
| `7202544` | `test: characterize selection Markdown boundaries` | Exact legacy Selection-context characterizations on unchanged production. |
| `8ac6b93` | `test: characterize Markdown edit scanner boundaries` | Exact edit ranges, diagnostics, review views, and malformed-input characterizations. |
| `469b1d6` | `refactor: share Markdown lexical and context scanning` | Context-only scanner and Selection migration. |
| `f86e49b` | `refactor: share Markdown fence and inline-code scanning` | Strict lines, containers, semantic/review/payload fences, inline code, and guard migration. |
| `5cf2226` | `refactor: share Markdown table scanning` | Table projection, row splitting, and final guard scanner deduplication. |

Tasks 1–5 received independent reviews through `5cf2226`. Task 6 changed only the ignored real-Obsidian harness and this evidence record; it required no production correction.

Explicit exclusions are a universal/CommonMark parser, a new Markdown AST or parser dependency, table Operations or structural table-edit enablement, relaxed conservative guards, changed diagnostics, automatic or container-aware Selection-context expansion, controller extraction, in-token behavior changes, new writers, shared write execution, freshness/target changes, provider/persistence changes, new dependencies, version metadata, workflows, and releases. PR 05 controller extraction and PR 06 actionable in-token rejection remain separate. Historical stage records and canonical ownership documents were not changed in this task.

## Design and alternatives

`src/markdown-scanner.ts` has no imports and owns literal source facts through three entry points:

- `scanMarkdownContext(source)` returns only the legacy Selection projection: LF-oriented context lines, document-leading frontmatter, and loose context fences.
- `scanMarkdown(source)` independently creates strict lossless lines and container, semantic-fence, Track Changes compatibility-shadow, and payload-fence projections. It does not call the context entry point.
- `scanMarkdownEditStructure(scan)` consumes an existing strict scan and adds inline-code and table projections using its lines and semantic fences rather than rescanning source lines.

`src/selection-context.ts` imports only `scanMarkdownContext`. It still owns complete-note short-circuiting, containing blocks, before-then-after adjacent expansion, source budgets, symmetric in-block truncation, and exact omission markers. It never computes edit-only projections.

`src/markdown-edit-guards.ts` imports the strict/edit entry points. It still owns Operation intersection and containment, first-violation ordering, payload wrappers and backtick pairing, affected-row original/annotated/accepted/rejected signatures, actual `compiledText`, and diagnostic production. `operation-edit-strategy.ts` retains public messages and correction behavior. Frontmatter remains a Selection-context construct, not a new edit exclusion.

The principal rejected alternatives were:

- **A universal Markdown parser or AST:** unnecessary dependency and behavioral risk for deliberately non-universal legacy projections.
- **Combined Selection and edit traversal:** would make Selection pay for edit-only structure and couple incompatible context, semantic-review, and payload rules.
- **Moving policy into the scanner:** would obscure why Selection expands a block or why an Operation is rejected and could change public behavior.
- **Keeping duplicate local scanners:** avoided the drift that this branch removes, including separate container, fence, inline-code, and table implementations.

No global cache, mutable shared scan state, benchmark claim, or universal grammar claim was added.

## Lossless and projection rules

All ranges are JavaScript UTF-16 code-unit offsets into the original string. Source text, NFC/NFD distinctions, whitespace, and malformed input remain literal. There is no Unicode, whitespace, CRLF/LF/lone-CR, or other normalization.

- Context lines split at LF, retain `\r` in line text/ranges, and create no synthetic line for empty input or after a trailing newline. Trimmed document-leading `---` frontmatter closes at trimmed `---` or `...`; an unclosed block extends through the real final scanned line without duplicate inner blocks. Context fences preserve legacy backtick-info acceptance, trimmed closing indentation, internal blanks, and unclosed EOF behavior.
- Strict lines preserve `start`, `contentEnd`, `end`, `text`, and `ending`; concatenating `text + ending` reconstructs the source exactly for LF, CRLF, lone CR, and mixed input. One-based diagnostic lookup retains content-end, EOF, and trailing-terminator edge behavior.
- Semantic fences retain container matching, visual indentation, unclosed/container-ended ranges, and exact insertion offsets. Review shadows remain separate ranges with their preceding-newline start and exact bare closing-run requirement. Payload fences retain wrapper-specific closed/unclosed and final-line-newline rules.
- Inline-code matching preserves complete-span containment, unequal/unmatched runs, escaped openers, closing-run backslash parity, multiline/container/lazy-continuation boundaries, and semantic-fence exclusion.
- Tables preserve same-container recognition, delimiter validation, body termination, absolute row/cell offsets, optional outer pipes, escaped-pipe parity, semantic-fence exclusion, and literal Unicode. Guards still accept only text changes wholly within existing header/body cells and still validate all review views.

## Characterization, RED, and code-head gates

Tasks 1 and 2 were characterization-first on unchanged production, not manufactured RED. Task 1 finished with **2 files / 111 tests**, and Task 2 with **4 files / 351 tests**. Their full suites passed **1,942** and **1,966** tests respectively. Hand-derived fixture mistakes were diagnosed as such and corrected without changing production behavior.

The migration tasks had genuine API/absence RED before implementation:

| Task | Pre-implementation result | Final focused result | Full suite at that task head |
| --- | --- | --- | --- |
| Context scanner | Missing `src/markdown-scanner`; 1 failed file, no tests ran | 3 files / 126 tests | 56 files / 1,981 tests |
| Fence and inline scanner | 41 failed / 15 passed: missing strict scanner/helper exports | 7 files / 519 tests | 56 files / 2,023 tests |
| Table scanner | 27 failed / 56 passed: missing table projection/splitter | 7 files / 546 tests | 56 files / 2,050 tests |

At `5cf2226`, the required Task 6 `npm test` passed **56 files / 2,050 tests**. `npm run lint` passed, and `npm run build` completed strict `tsc -noEmit -skipLibCheck` followed by the production esbuild bundle. These are the actual gates available at the code head, not claims about a later documentation head.

## Real-Obsidian evidence

The ignored PR 03 verifier, mock provider, model controls, runtime prerequisites, and Track Changes companion were provisioned from the PR 03 worktree. Failure propagation through final `process.exitCode` was retained. The focused scenarios and deterministic loopback responses were implemented before execution.

A deliberate **harness-only** negative control forced one synthetic assertion failure. The command exited **1**, and `summary.json` recorded **0 passed / 1 failed** with scenario `00-harness-only-negative-control`. This was not a product failure. The forced branch was removed before evidence runs.

The final commands were:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --markdown-scanner
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

| Runtime group | Scenarios | Assertions |
| --- | ---: | ---: |
| `--markdown-scanner` | 10 passed, 0 failed | 318 |
| `--stabilization` | 6 passed, 0 failed | 55 |
| `--edit-freshness` | 24 passed, 0 failed | 227 |
| `--edit-target-flow` | 5 passed, 0 failed | 95 |
| `--sessions` | 9 passed, 0 failed | 156 |
| **Total** | **54 passed, 0 failed** | **851** |

Every final summary records head `5cf2226b6db98aa04c0f9abb881307e94032e20e`, `loadedBundleMatchedRoot: true`, and equal SHA-256 values:

```text
root main.js:   9348dc70550568e54e2905310579f290cb882d8c82c5f613f1cdeb777723c3ea
loaded main.js: 9348dc70550568e54e2905310579f290cb882d8c82c5f613f1cdeb777723c3ea
```

Setup and final summary hashing both matched. Preserved evidence is under ignored `test_vault/emend-selection-chat-verify/evidence-task6-pr04/`; generated bundles, runtime vault content, request logs, screenshots, and summaries were not committed.

### Focused scenario matrix

| Scenario | Actual code-head result |
| --- | --- |
| Closed frontmatter Smart context and native undo | An over-budget LF note sent the exact complete trimmed frontmatter plus `\n[...]`. Selection offsets 15–21 received one native `{~~TARGET~>value~~}` replacement, with zero guarded vault writes. Disk bytes matched exactly; native undo/redo restored original and annotated complete documents. |
| Unclosed frontmatter and fence | Unclosed frontmatter retained all 1,000 source characters through the last non-synthetic line plus the exact omission suffix, without duplicated inner content. The unclosed fence context was exactly `[...]\n~~~\nfirst\n\nTARGET\n\n[...]`. Internal blanks were intact; both no-op responses made zero writes and preserved bytes. |
| Legacy multiline context fence | Smart context retained the complete opener made from three backticks, info `alpha`, and three more backticks, plus the body, internal blank, closer, and adjacent `After.` block as exact legacy context. `operations: []` made zero writes. The record does not claim an inline-code outcome for this fixture; the same top-level opener also creates a Track Changes compatibility shadow because that projection accepts info text. |
| Inline-code distinction | `Before ```alpha``` followed by prose\nNext prose` remained inline code rather than a semantic/container-free review opener. Content-only `alpha` produced exact `inline-code-range` diagnostics and message, two invalid requests, and zero writes. Its exact Smart context was asserted separately. |
| Container semantic fences | Quote/list inside-fence candidates returned exact line-2 `fenced-code-edit` diagnostics with two calls and zero writes. Quote-following prose remained editable with one native replacement; list-following prose returned exact line-4 rejection with two calls and zero writes. Actual prompts retained legacy paragraph/indented-opener context behavior rather than gaining container-aware expansion. |
| Review shadow and exact closer | List-created shadow following prose returned exact line-4 `fenced-code-edit`, two calls, and zero writes. The top-level exact-close control used one guarded vault write and real Track Changes commands: accept produced `Following`; native undo restored the annotation; reject restored `After`. |
| Safe table Full-note edit and review | A list-contained table with an escaped cell pipe and literal Unicode used exactly one guarded `vault.modify` and zero native replacements. The annotation was `{~~one~>茶🙂~~}`. Track Changes 2.3.0 accept preserved `茶🙂 \| two`, `值🙂`, and decomposed `e\u0301`; reject restored every original byte. |
| Safe table Selection edit | Only native `replaceRange` ran, at captured offsets 52–62, with exact `{~~one~>first~~} \| two` replacement and zero guarded vault writes. Outside-Selection bytes remained exact, and native undo/redo restored complete original/annotated documents. |
| Unsafe table and malformed candidates | Cross-cell and even-backslash cases retained exact `table-structure-edit` diagnostics; unclosed-fence and unbalanced-payload cases retained exact `fenced-code-edit` fields/lines/messages. Each made exactly one correction (two requests total) and zero writes with unchanged bytes. |
| Selection confinement, CRLF, and privacy | An outside-Selection target returned exact `missing-target` details including `matchCount: 0` and `matchLines: []`, two calls, and zero writes. The final CRLF control had CRLF-only disk and LF-only host editor text, failed with the exact stale message after one request, made zero writes, and preserved every raw CRLF byte. No real CRLF success is claimed. |

The frontmatter fixture uses the scanner's supported trimmed/indented form so Obsidian's Properties widget cannot hide the raw YAML Selection. Tables use a supported list container to prevent Obsidian's top-level table formatter from changing fixture bytes outside Emend's writer. These are host-harness constraints, not new product parsing claims. For the final CRLF control, the harness restored raw CRLF disk bytes and set the open host editor to LF before release (`controlNormalizationApplied: true`) to exercise the required divergence deterministically.

### Writer, request, review, and privacy audit

Both writers were instrumented on every focused note. Full-note successes called only guarded `vault.modify`; Selection successes called only native `editor.replaceRange` at captured offsets. Every rejected/no-op case had zero calls to both. Track Changes accept/reject used the actual `track-changes:accept-change-at-cursor` and `track-changes:reject-change-at-cursor` commands, not a reimplementation of CriticMarkup projection.

Actual request bodies supplied the asserted Selection/Full-note context and no tools. Every invalid candidate used the same provider for exactly one correction with exact bounded JSON diagnostics. Nineteen focused request logs contained no authorization headers, HTTP header objects, or dummy credential.

Nineteen focused saved-chat files contained only ready messages. Raw candidates, rejected summaries/reasoning, correction diagnostics, request/Selection snapshots, and the dummy credential were absent. Errors did not persist as ready answers. All evidence remained under ignored synthetic-vault paths.

## Environment and limits

Actually exercised: Linux `x86_64`, kernel `6.12.117+deb13-amd64`; official Obsidian **1.15.0** AppImage; isolated Xvfb `:101`; CDP `19224`; default dark theme as shown in preserved screenshots; Track Changes **2.3.0**. Actions used real DOM/workspace/editor calls and trusted CDP-dispatched events, not physical OS-level input.

Provider evidence is loopback OpenAI-compatible SSE/CORS at `127.0.0.1:18766`, deterministic synthetic Operations/responses, and a dummy SecretStorage credential. No real account, real credential, external network, paid call, or real-provider behavior was used.

Unit tests use Obsidian mocks and do not establish host bytes or native undo. No Windows, macOS, mobile, screen-reader, physical-input, third-party-theme, other-Obsidian-version, other-Track-Changes-version, real-CRLF-success, or unexercised platform/provider coverage is claimed. Host Properties/table formatting and save timing are limits of this runtime matrix, not reasons to normalize production source. Final documentation-head gates, canonical ownership updates, independent factual review of this record, and whole-PR submission remain later work.
