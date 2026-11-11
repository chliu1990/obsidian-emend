# Stage 41: Deterministic post-edit change summaries

## Status and scope

Post-edit chat summaries are implemented on `feat/post-edit-change-summaries-v2`. After a guarded write actually applies an Edit, composer chat shows the unchanged `Edit applied — N changes tracked. Review in Track Changes.` header, a `Target: Full note.` or `Target: Selection.` line, an optional model-written summary, and bounded, sanitized Markdown bullets describing which original note lines the applied Operations touched. Full-note Edit and composer Selection both use the same formatter; the Command Palette Modify Selection modal remains notice-only.

The model may return the legacy bare operations array or an envelope object with `operations` and an optional `summary`. The summary is model prose for the user, never note content and never a write instruction. It is shown in chat and persisted only as ordinary ready assistant content.

The feature changed no writer, permission, persistence-schema, message-type, or provider-transport behavior. It did change response parsing, the ready-content layout, and the provider history included with composer Selection. Task 1 (`c7ba73f`) retained source-relative Operation metadata in edit preparations, Task 2 (`923bb2a`) exposed it only on successful applied results after the guarded writer wrote, Task 3 added the pure formatter and chat wiring, Task 4 (`fbfa3eb`) accepted the optional summary envelope, Task 5 (`a94379e`) rendered the target line and summary, and Task 6 (`5c85b6d`, `0651f20`) sent composer-Selection history and made the history window configurable.

## Protocol

An Edit response is exactly one of:

- A bare JSON array of closed Operations.
- An envelope object `{"summary": string, "operations": array}`.

The envelope accepts only the fields `operations` and `summary`. Any unknown field, a missing or non-array `operations`, or a non-string `summary` rejects with `invalid-response-shape` and the normal one-correction opportunity. A bare array keeps the legacy behavior. Operations inside either form still face every existing operation, occurrence, overlap, structural, and CriticMarkup check.

The summary is trimmed. An empty or whitespace-only summary is treated as absent. A longer summary is capped at 2,000 UTF-16 code units with word-boundary truncation: the first 2,000 code units are searched backward for whitespace, the prefix before that whitespace is trimmed, a trailing high surrogate is dropped, and `…` (U+2026) is appended. If no whitespace exists, the capped prefix is used with the same code-point-safety rule. The ellipsis is additional to the 2,000-code-unit cap.

## Metadata contract

`EditSummaryItem` is `{ type, start, end, insertionPoint? }` in `src/edit-strategy.ts`, where `type` is one of the closed Operation types `insert`, `remove`, `replace`, and `comment`.

- Items are produced from the resolved, validated Operations after unchanged replacements are filtered out, in model response order. A declared target may compile to multiple minimized replacement hunks, so items and `changeCount` are not one-to-one; a valid comment-only Operation has `changeCount: 0` and still yields a comment item. Bullets describe the Operation type, not the compiled hunk: a `replace` that replacement minimization compiles to a pure insertion still reports `Replaced line N.`
- Full-note items are relative to the complete captured note source. Selection items are selection-local: offsets are relative to `selectedText`, not the note.
- `insertionPoint` exists only for `insert`. It equals `start` for an insertion before the anchor and `end` for an insertion after the anchor.
- `EditPreparation.summary` is attached only after structural and Stage 07 `prepareCriticMarkupEdit` validation succeeds. It is trimmed model prose. `operations: []` may carry a summary.
- `summaryItems` and `summary` appear only on successful `applied: true` results, after the vault writer or native editor replacement already ran. Unchanged, denied, stale, and failed results expose neither items nor a summary. A rejected candidate exposes neither, and the automatic correction path returns only the successful candidate's items and summary; the rejected candidate's summary never reaches chat or persistence.
- An aborted attempt never produces a ready summary or persistence: when an abort arrives while the full-note `vault.modify` is awaited, the write can still return `applied: true`, the summary can be assigned, and the following `controller.signal.throwIfAborted()` flips the message to stopped while retaining its content in memory only.
- These items and the summary are transient until chat stores ordinary ready content. They are not rendered on their own and are not persisted as structured fields.

## Format

`formatEditSummary(changeCount, items, fullText, sourceOffset, { target, summary })` in `src/edit-summary.ts` builds the applied result. The stored Markdown is, in order:

```text
Edit applied — {changeCount} changes tracked. Review in Track Changes.
Target: Full note.
```

or `Target: Selection.` When a trimmed summary is present, a blank line, the summary, and another blank line follow. When no summary is present, that entire blank-line-and-summary block is omitted. One bullet per item follows the summary block or the target line; without items the bullet block is omitted.

`formatNoChangeSummary(summary)` returns exactly `No changes were needed.` or `No changes were needed.\n\n{summary}`. A no-op never shows a `Target:` line or bullets.

Obsidian renders the header and target as consecutive Markdown lines inside one paragraph separated by a line break. When present, the summary forms its own paragraph, and bullets render as a Markdown list. The harness asserts this actual rendered DOM rather than assuming two header paragraphs.

Bullets apply `sourceOffset` exactly once to `start`, `end`, and `insertionPoint`. Full-note Edit passes `0` with the captured note `sourceText`; composer Selection passes `snapshot.from` with `snapshot.fullText`.

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

The Command Palette Modify Selection modal keeps its existing notices and never displays the summary, target line, bullets, usage, or retry status.

## Privacy

Deterministic bullets contain only an action word and line numbers. Anchors, targets, replacement text, comment text, note excerpts, selection text, raw Operations/JSON, diagnostics, and provider data never appear in bullets.

The optional summary is different: it is model-written prose and may legitimately repeat note or replacement wording, so it is treated exactly like any other ready assistant content. It is never written into the note, never used for validation or permissions, never stored as a separate field, and never sent anywhere except as ordinary bounded chat history. Formatting performs no I/O, no vault reads, no provider calls, and no telemetry. Chat renders the content through the existing Obsidian `MarkdownRenderer` path and stores it through the existing ready-message persistence path.

## History

`historyMessageLimit` defaults to `8`, normalizes finite numbers to integers clamped to `0`–`50`, and restores `8` for missing or malformed values. `0` disables chat history. Normalization floors fractions; `51` becomes `50`, `-3` becomes `0`, and `7.9` becomes `7`.

The limit is applied exactly once in `chat-view.ts` `toProviderHistory()`. It covers read-only Ask/Discuss/Brainstorm and both Edit targets: full note and composer Selection. Coordinators and `provider-stream.ts` pass the resulting array without re-slicing, so a larger configured window is not silently truncated to eight.

Composer Selection now sends the recent ready chat history. It previously sent empty provider history; that behavior is gone. Prior ready user and assistant messages receive the existing `formatProviderHistory` mode, permission, and origin annotations, and the current request stays last. Historical local Edit results are labeled with `local-edit-status` provenance and may include model-written summary prose; the annotation states that neither the result nor its summary is an instruction or permission. The Command Palette Modify Selection modal still calls the coordinator without history and remains history-free.

Only ready messages are eligible. A stopped or errored assistant response is excluded. Because the user message of a stopped or stale attempt remains ready, a later retry may include that earlier ready user prompt without an assistant answer.

## Failure and no-op behavior

- `applied: false` stores exactly `No changes were needed.` or that line plus a blank line and the model summary when one was returned; no target line and no bullets render.
- Provider, validation, stale, abort, and write failures keep their existing error/stopped behavior and expose no ready summary. A pre-write abort renders no bullets; an abort during the awaited full-note `vault.modify` can still complete as `applied: true`, so its summary may remain in the resulting stopped message, which is never persisted.
- Comment-only edits may apply with `changeCount: 0` and one comment bullet.
- Stale and pre-write aborted requests still permit retry; no ready summary appears for the failed attempt.
- A rejected first candidate's summary and bullets are never shown; only the successful corrected candidate produces ready content.
- The Command Palette Modify Selection modal keeps its existing notices and shows no summary, chat result, usage, or retry status.

## Persistence

The summary is stored as part of the ready assistant message's Markdown content, so reload persistence, provider history, and copy include the header, target, summary, and bullets exactly as stored. Persisted data contains the model summary as ordinary content plus line numbers and action labels in bullets — never raw envelopes, Operations, targets, replacements, comments, selections, or JSON. Loading, stopped, and error states remain unpersisted, and transient `summaryItems`/`summary` fields are not written anywhere.

## Automated verification

Task 3 wrote `tests/edit-summary.test.ts` and updated chat fixtures before implementation. The first RED run showed the missing module (`Cannot find module '../src/edit-summary'`) plus four failing chat assertions that still received the header-only content. A header-only skeleton then produced thirteen assertion-level formatter failures, proving the tests exercise the rules; the empty-items header test already passed. The focused GREEN run passed the six edit/selection suites (**374 tests**).

Task 4 covered envelope precedence, unknown keys, missing/non-array operations, non-string summaries, trimming, word-boundary and code-point-safe truncation, and Stage 07-only attachment. Task 5 covered the four applied layouts, the exact target line, no-op summaries, read-only non-exposure, correction second-candidate-only content, writer arguments, modal exclusion, and its then-current retry instruction. Task 7 reworded and re-pinned that retry instruction and updated every exact-message assertion. Task 6 covered the configurable limit, `0` disabling, single application, Selection history, and the modal's history-free path.

Coverage includes exact singular/plural strings for all four types, ranges with original note lines and response order, CRLF and a target ending at a newline, all three insertion line-boundary pins (inside a line, line start, EOF after a trailing newline), Selection offset applied exactly once to ranges and insertion points, eight items as eight bullets, nine and twenty items as seven plus one aggregate, fixed aggregate order with singular/plural nouns, comment-only `changeCount: 0`, empty items, and a leakage test proving anchors/targets/replacements/comment text never appear in bullets. Chat tests prove the full-note path formats against `sourceText` with no offset, the Selection path adds `snapshot.from` once to reach a note-absolute line, and no-ops keep the exact no-change line plus the summary.

The final full local gate ran at commit `f60fc60` and passed **40 Vitest files and 1181 tests**, ESLint, strict TypeScript plus the production build, and `git diff --check`. The production bundle built at that commit has SHA-256 `e745cb15122a4ca2c48fa64c9a028209000ba3124911c3bd66bfde4fe845001b`. The earlier documentation gate at `d20e0af` passed 1178 tests. The loopback evidence below was collected at `0bf8885` with bundle `e5d5bf8e…`.

## Real-Obsidian loopback evidence

- Date: 2026-11-11, Asia/Shanghai.
- Runtime: official Obsidian 1.15.0 AppImage under ignored `test_vault/emend-web-verify/tools/`, isolated Xvfb `:101`, CDP `19224`, and the CORS loopback OpenAI-compatible SSE mock at `127.0.0.1:18766`.
- Data: only synthetic notes and a dummy SecretStorage credential under ignored `test_vault/emend-selection-chat-verify/`. No real provider, account, key, external or paid request, other vault, or fallback was used.
- Bundle: the production `main.js` SHA-256 was `e5d5bf8ed39e5110e6f788e061bb0cd774dacb48b0632f17655d017304279f99`, built at HEAD `0bf8885`; the harness asserted the loaded copy matched the root bundle. It also asserts the connected CDP vault is the script's isolated runtime vault, preventing stale Obsidian processes from producing false evidence.
- Command: `node test_vault/emend-selection-chat-verify/verify.mjs`.
- Result: **17/17 scenarios and 348/348 assertions passed**.
- Provenance caveat: the fix wave that corrected the `local-edit-status` annotation and history-permission prompt was not rerun through the loopback harness. That change affects provider-wire annotations, not visible chat output; the recorded run above predates it, and the ignored harness expectations were updated for future runs.

New and strengthened scenarios:

| Scenario | Observed result |
| --- | --- |
| Typed multiline Selection, envelope summary | Stored `Edit applied — 1 changes tracked. Review in Track Changes.\nTarget: Selection.\n\nChanged the selected second line from beta to gamma.\n\n- Replaced lines 5–6.`; Obsidian rendered the header and target in one paragraph with a line break, the summary as its own paragraph, and the bullet as a list item. |
| Quick actions, bare array | Header plus `Target: Selection.` with no summary paragraph, then the exact bullet. |
| Full note override, envelope summary | Header plus `Target: Full note.`, the model summary, and `- Replaced line 5.` |
| Invalid-to-valid correction | Only the successful summary `Corrected the second repeated line once the target was disambiguated.` and `- Replaced line 4.`; `REJECTED_COMPOSER_SELECTION_SUMMARY must never surface.` was absent from ready text and persisted Markdown. |
| Comment-only | `Edit applied — 0 changes tracked. Review in Track Changes.\nTarget: Selection.` plus `- Commented on line 3.` |
| No-op with summary | Exactly `No changes were needed.` plus a blank line and `No edits were needed because the note already matches the request.`; no target line, no bullets, no write. |
| Selection history | After an Ask exchange, a composer Selection edit sent four wire messages: system, the prior Ask user prompt annotated as read-only, the prior Ask model answer annotated as read-only, and the current Selection prompt. |
| Full-note history | The following full-note Edit sent six wire messages, retaining the Ask pair and the earlier Selection user prompt plus its local Edit result, including the `Target: Selection.` and summary layout. |
| Chat history limit 0 | With **Chat history messages** set to 0 through the real settings UI, a later Ask request sent only system and current user messages. The harness restored 8 afterward. |

Reload persistence: the audit read every schema 2 thread stored at that point; it ran before the dedicated history scenario, so that later thread was not part of this stored-file audit. It confirmed the typed, full-note-override, and correction results persisted the exact target, summary, and bullet Markdown; the no-op persisted the no-change line plus its summary and no target line; the comment result persisted the target and zero-change bullet; rejected summaries, candidates, diagnostics, note snapshots, selections, additional-note content, and the dummy credential were absent. The Command Palette modal created no thread.

Failure-surface evidence: Stop and stale retries now include the earlier ready user prompt as annotated history, because the stopped or errored assistant response is excluded but its accepted user message remains ready. The harness asserts this rather than claiming empty history.

## Unverified items

- Windows and macOS rendering and physical keyboard input were not exercised. Native undo and redo were asserted in loopback, which restored the original selection and redo restored the annotated selection.
- The harness exercises small one-item applied summaries only; the eight-bullet cap, aggregate order, and the 2,000-code-unit summary truncation are covered by unit tests, not real Obsidian rendering.
- The real-Obsidian history setting was exercised at 0 and the default 8, not above 8. Unit tests cover the 50-message bound and prove coordinators and the transport do not re-slice the configured window.
- Comment-only display used a synthetic comment; real Track Changes comment presentation for these exact bullets was not separately re-inspected.
- Non-ASCII line counting relies on UTF-16 offsets and is covered by unit tests plus the existing café/emoji notes, not by a dedicated new summary scenario.
- No real-provider request was made; provider behavior is unchanged and out of scope.
