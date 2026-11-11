# Stage 41: Deterministic post-edit change summaries

## Status and scope

Post-edit chat summaries are implemented on `feat/post-edit-change-summaries-v2`. After a guarded write actually applies an Edit, the composer shows the unchanged `Edit applied — N changes tracked. Review in Track Changes.` header plus bounded, sanitized Markdown bullets describing which original note lines the applied Operations touched. Full-note Edit and composer Selection both use the same formatter; the Command Palette Modify Selection modal remains notice-only.

No provider, writer, persistence-schema, or message-type behavior changed. The summary is ordinary ready assistant content produced locally from transient metadata that was already required to apply the edit. Task 1 (`c7ba73f`) retained source-relative Operation metadata in edit preparations, Task 2 (`923bb2a`) exposed it only on successful applied results after the guarded writer wrote, and this stage adds the pure formatter, the chat wiring, documentation, and verification.

## Metadata contract

`EditSummaryItem` is `{ type, start, end, insertionPoint? }` in `src/edit-strategy.ts`, where `type` is one of the closed Operation types `insert`, `remove`, `replace`, and `comment`.

- Items are produced from the resolved, validated Operations after unchanged replacements are filtered out, in model response order. A declared target may compile to multiple minimized replacement hunks, so items and `changeCount` are not one-to-one; a valid comment-only Operation has `changeCount: 0` and still yields a comment item. Bullets describe the Operation type, not the compiled hunk: a `replace` that replacement minimization compiles to a pure insertion still reports `Replaced line N.`
- Full-note items are relative to the complete captured note source. Selection items are selection-local: offsets are relative to `selectedText`, not the note.
- `insertionPoint` exists only for `insert`. It equals `start` for an insertion before the anchor and `end` for an insertion after the anchor.
- `summaryItems` appears only on successful `applied: true` results, after the vault writer or native editor replacement already ran. Unchanged, denied, stale, and failed results expose empty items and never reach the formatter. An aborted attempt never produces a ready summary or persistence: when an abort arrives while the full-note `vault.modify` is awaited, the write can still return `applied: true`, the summary can be assigned, and the following `controller.signal.throwIfAborted()` flips the message to stopped while retaining its content in memory only.
- These items are transient. They are not persisted, not sent to any provider, and not rendered on their own.

## Format

`formatEditSummary(changeCount, items, fullText, sourceOffset)` in `src/edit-summary.ts` returns the header alone when there are no items:

```text
Edit applied — {changeCount} changes tracked. Review in Track Changes.
```

Otherwise it appends one bullet per item, in response order, after applying `sourceOffset` exactly once to `start`, `end`, and `insertionPoint`. Full-note Edit passes `0` with the captured note `sourceText`; composer Selection passes `snapshot.from` with `snapshot.fullText`.

Lines are 1-based UTF-16 offsets split on `\n`, so CRLF text works without normalizing it:

- `lineAt(fullText, offset)` is the number of `\n` before `offset` plus one, clamped to `[0, fullText.length]`. Offset `0` is line 1; `fullText.length` is the final line, which is the empty final line when the text ends with `\n`.
- A non-insert range with `end > start` reports `first = lineAt(start)` and `last = lineAt(end - 1)`, so a target ending at a newline does not claim the following line. A defensive zero-width non-insert range collapses to one line.
- An insertion names the one line containing its point: `lineAt(insertionPoint)`. A point inside a line uses that line, a point at a line start uses the new line, and EOF after a trailing newline uses the final empty line. The preposition is `before` when `insertionPoint === start` and `after` otherwise. A defensive insert item without `insertionPoint` falls back to `start`, so it reports `before`.

Bullets use the exact action wording:

```text
- Inserted text before line N.
- Inserted text after line N.
- Removed line N.
- Removed lines N–M.
- Replaced line N.
- Replaced lines N–M.
- Commented on line N.
- Commented on lines N–M.
```

`N–M` uses the en dash (U+2013). `changeCount` is the applied preparation's tracked CriticMarkup hunk count and is never recomputed from the bullets.

Eight-bullet cap: up to eight items render one bullet each. More than eight items render the first seven in response order and one aggregate bullet covering every remaining item by type in the fixed order `insert`, `remove`, `replace`, `comment`, skipping zero counts:

```text
- And 2 more insertions, 1 more removal, 2 more replacements, 1 more comment.
```

Nouns are `insertion(s)`, `removal(s)`, `replacement(s)`, and `comment(s)`; each part always includes its count and `more`. Total bullets never exceed eight.

## Privacy

Bullets contain only an action word and line numbers. Anchors, targets, replacement text, comment text, note excerpts, selection text, raw Operations/JSON, diagnostics, and provider data never appear. Formatting performs no I/O, no vault reads, no provider calls, and no telemetry. `src/edit-summary.ts` is pure and imports only the `EditSummaryItem` type.

Chat renders the summary through the existing Obsidian `MarkdownRenderer` path as ordinary sanitized assistant content and stores it through the existing ready-message persistence path. Conversation schema 2, message shapes, copy behavior, and history are unchanged; no new field or message type was added. The rendered result is a normal paragraph plus Markdown list.

## Failure and no-op behavior

- `applied: false` still stores exactly `No changes were needed.`; no bullets render.
- Provider, validation, stale, abort, and write failures keep their existing error/stopped behavior, expose no summary items, and render no bullets.
- Comment-only edits may apply with `changeCount: 0` and one comment bullet.
- Stale and aborted requests still permit retry; summaries never appear for the failed attempt.
- The Command Palette Modify Selection modal keeps its existing notices and shows no summary, chat result, usage, or retry status.

## Persistence

The summary is stored as the ready assistant message's Markdown content, so reload persistence, provider history, and copy include the header and bullets exactly as displayed. Persisted data contains only line numbers and action labels — never source, targets, replacements, comments, selections, or JSON. Loading, stopped, and error states remain unpersisted, and transient `summaryItems` are not written anywhere.

## Automated verification

Task 3 wrote `tests/edit-summary.test.ts` and updated chat fixtures before implementation. The first RED run showed the missing module (`Cannot find module '../src/edit-summary'`) plus four failing chat assertions that still received the header-only content. A header-only skeleton then produced thirteen assertion-level formatter failures, proving the tests exercise the rules; the empty-items header test already passed. The focused GREEN run passed the six edit/selection suites (**374 tests**).

Coverage includes exact singular/plural strings for all four types, ranges with original note lines and response order, CRLF and a target ending at a newline, all three insertion line-boundary pins (inside a line, line start, EOF after a trailing newline), Selection offset applied exactly once to ranges and insertion points, eight items as eight bullets, nine and twenty items as seven plus one aggregate, fixed aggregate order with singular/plural nouns, comment-only `changeCount: 0`, empty items as header only, and a leakage test proving anchors/targets/replacements/comment text never appear. Chat tests prove the full-note path formats against `sourceText` with no offset, the Selection path adds `snapshot.from` once to reach a note-absolute line, and no-ops keep the exact existing text.

The full local gate passed **40 Vitest files and 1123 tests**, ESLint, strict TypeScript plus the production build, and `git diff --check` at gate commit `339a7d5` (the review-polish commit; the only later branch commits are documentation-only and do not change the tested tree).

## Real-Obsidian loopback evidence

- Date: 2026-11-11, Asia/Shanghai.
- Runtime: official Obsidian 1.15.0 AppImage already under ignored `test_vault/emend-web-verify/tools/`, isolated Xvfb `:101`, CDP `19224`, and the CORS loopback OpenAI-compatible SSE mock at `127.0.0.1:18766`.
- Data: only synthetic notes and a dummy SecretStorage credential under ignored `test_vault/emend-selection-chat-verify/`. No real provider, account, key, external or paid request, other vault, or fallback was used.
- Bundle: the production `main.js` SHA-256 was `9463bf33d4ec24e05f95c644e7980fa2bda4fa41a5671f57c3b6bf455e8a4cd1`, and the harness asserted the loaded copy matched the root bundle.
- Provenance: the harness copied `main.js` built from commit `bd091ce`, the last branch commit that touches `src/` (this document's commit changes documentation only). The production build embeds the short HEAD SHA as its build ID, so rebuilding after a documentation-only commit changes the bundle bytes but not the tested source or behavior.
- Command: `node test_vault/emend-selection-chat-verify/verify.mjs`.
- Result: **15/15 scenarios and 298/298 assertions passed**. The harness now asserts rendered summary structure (header paragraph plus `<li>` text) and persisted Markdown for representative scenarios.

Observed strings (rendered text separates the header and list with a blank line; stored Markdown uses a single newline):

| Scenario | Path | Observed summary |
| --- | --- | --- |
| Typed multiline Selection | composer Selection, `from` at note line 5 | `Edit applied — 1 changes tracked. Review in Track Changes.` + `Replaced lines 5–6.` |
| Fix grammar quick action | composer Selection, line 3 | header + `Replaced line 3.` |
| Make concise quick action | composer Selection, line 3 | header + `Replaced line 3.` |
| Add examples quick action | composer Selection, line 3 | header + `Replaced line 3.` (Operation is a replace even though minimization compiled an insertion) |
| Full note override | full-note writer, line 5 | header + `Replaced line 5.` |
| Invalid-to-valid correction | composer Selection, line 4 | header + `Replaced line 4.` only; both candidates and targets absent |
| Comment-only | composer Selection, line 3 | `Edit applied — 0 changes tracked. Review in Track Changes.` + `Commented on line 3.` |
| Next visible full-note Edit | line 3 | header + `Replaced line 3.` |

Reload persistence: every stored ready assistant Edit message contained the exact Markdown `Edit applied — N changes tracked. Review in Track Changes.\n- <bullet>`; the Typed thread stored `- Replaced lines 5–6.`, the Correction thread stored `- Replaced line 4.`, and the Comment thread stored `- Commented on line 3.`. The persistence audit also confirmed no raw Operations, candidates, diagnostics, snapshot fields, additional-note content, or dummy credentials were stored, and the modal created no thread.

## Unverified items

- Windows and macOS rendering and physical keyboard input were not exercised. Native undo and redo were asserted and passed in loopback scenario 01, which restored the original selection and redo restored the annotated selection.
- The harness exercises a one-item summary only; the eight-bullet cap and aggregate order are covered by unit tests, not real Obsidian rendering.
- Comment-only display used a synthetic comment; real Track Changes comment presentation for these exact bullets was not separately re-inspected.
- Non-ASCII line counting relies on UTF-16 offsets and is covered by unit tests plus the existing café/emoji notes, not by a dedicated new summary scenario.
- No real-provider request was made; provider behavior is unchanged and out of scope.
