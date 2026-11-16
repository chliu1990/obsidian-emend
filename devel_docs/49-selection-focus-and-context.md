# Stage 49: Selection focus and shared Selection context

## Status and scope

Selection-focused Chat and explicit full-note Selection context are implemented and verified on `feat/2.10-selection-focus`. Runtime Tasks 1–4 end at `743bb362e4324e59d74f0f83ca1ef42616cbf88a`; the follow-up selection-presentation fix is `cd175711e57624d4908e5375d240712d3637b4a2` (`fix: normalize remapped selection decorations`). The final runtime bundle is `72a2627dc33cd0dc37b7cd47745d5bbdbe8591101e468ea6dc11538a92e65c61`.

Issue [#51](https://github.com/chliu1990/obsidian-emend/issues/51)'s approved behavior is shipped. The issue link is retained for history; verification and documentation did not close or mutate it. No release metadata was bumped and no later stabilization or release assets are claimed.

## Current behavior

### Writing choices and per-view state

The **Writing and web search** menu contains, in order:

1. **Chat**
2. **Chat · Selection**
3. **Edit · Selection**
4. **Edit · Selection · Full note**
5. **Edit · Full note**
6. **Web Off**
7. **Web Review**
8. **Web Auto**

All five writing choices remain visible without a usable selection. Chat Selection is explicit and is never inferred merely because text is selected. Its summary accepts the existing Web suffixes, producing **Chat · Selection · Review search** and **Chat · Selection · Auto search**. Full-note Selection Edit remains distinct from ordinary full-note Edit and displays **Edit · Selection · Full note**. Their tooltips disclose `Full note is sent with the selection as focus.` and `Full note is sent; only the selection is edited.` respectively.

Chat target and Selection-context policy are per-view, memory-only choices. Same-note session switches retain them. An actual target-note change resets Chat Selection to ordinary Chat, Selection context to Default, and Edit targeting to automatic while preserving Chat/Edit mode and the retained Chat Web choice. Menu/context changes alone perform no provider request, additional-note content read, persistence mutation, or note write. No selection-preview card, focus widget, automatic Chat Selection, new message mode, schema field, or global Selection-context setting was added.

### Chat Selection prompt and failure contract

Ordinary Chat retains the bounded selection/caret-centered Active-note Markdown window. Chat Selection captures exact current usable selection offsets synchronously and uses the existing writer-free `ask` coordinator with:

````text
Active note Markdown:
```markdown
Full note (supporting context):
<complete active-note source>

Selected text (read-only conversational focus):
<complete selected text>
```

User message:
<current prompt>
````

The complete source ignores the ordinary bounded-note window. The separate focus copy remains complete for multiline, Unicode, and over-budget selections; duplicate selected-text tokens are intentional. Recent ready history, additional-note snapshots, instructions/skills, usage, persistence sanitization, and supported DeepSeek Review/Auto routing retain their existing paths. Chat Selection has no note writer.

Empty, whitespace-only, collapsed, or vanished focused selections show `Select non-whitespace text first.` They create no user/assistant/loading/error message, conversation save, instruction or additional-note read, provider request, retrieval, note write, or fallback to ordinary Chat. A running request retains its captured identity and existing note/session generation, Stop, and per-note lock behavior.

### Selection Edit Default and Full note

**Edit · Selection** preserves the previous Default prompt byte for byte. Smart context still expands containing/adjacent structural blocks within the source-character budget with exact omission markers; disabling smart context retains the Stage 09 symmetric `Context before`/`Context after` algorithm. Full-note Selection Edit instead shares this prompt shape:

````text
Full note (supporting context):
<complete active-note source>

Selected text (the only edit target):
<complete selected text>

User message:
<current prompt>
````

Typed requests and **Fix grammar**, **Make concise**, and **Add examples** all honor the maintained target and context policy exactly once and force Web off. Complete-note supporting context does not expand occurrence resolution, Operation anchors, structural write permission, compilation, or native replacement beyond the captured selection. Outside-selection candidates still receive only the existing single correction and fail with zero writes when the second candidate is also invalid. Successful edits retain concise chat results, all-round usage, successful-attempt reasoning, exact CriticMarkup, and native undo.

Modify Selection adds a native **Selection context** selector with **Default (Smart)** or **Default (Symmetric)** from current settings and **Full note**. The disclosure is exactly `Full note sends the complete note; only the selection is edited.` It resets to Default on every open, changes only local estimates when selected, disables while pending, and uses the same full-note/target prompt as composer Selection Edit. It sends no chat history and retains notice-only results without chat, usage, reasoning, or retry displays.

### Capacity and privacy

Draft estimates and authoritative submission checks reuse the actual target/policy prompt assembly. Chat Selection and full-note Selection Edit therefore include the complete note, separate duplicate selection, and focus/target labels rather than using the old bounded estimate. Exact-boundary drafts disable Send and affected quick actions, consume Enter/Mod+Enter with the existing Notice, and make no request, message, save, retrieval, or write. Existing exclusions for unread instructions/additional-note contents and later rounds remain unchanged; the exact submission check stays authoritative.

Only explicit submission sends full-note/focus content to the configured provider. Selection/context choices, explorer interactions, modal opening, and note/session switches perform no networking. Persisted messages retain schema 3 and `ask`/`edit` metadata only: no selection snapshot, offsets, focus text, context-policy choice, or full-note prompt is stored. Ready content retains only its existing sanitized answer/result, usage, reasoning, and optional Web metadata.

## Selection-presentation defect and root-cause evidence

### Reproduction and host trace

The initial complete matrix failed historical scenario 09 with `RangeError: Mark decorations may not be empty`. A fresh isolated rerun reproduced it:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --stale-only
```

The scenario selects `Stale target changes.`, holds a Selection response, inserts `USER_STALE_EDIT ` at position zero, releases the response, and correctly observes the terminal stale-source rejection with no model write. Restoring the original source through `editor.setValue(before)` with the selection active then threw inside Emend's decoration update.

Temporary in-memory diagnostics captured the actual host transaction ranges and were removed before the unit regression:

| Boundary | `docChanged` | Explicit selection | Result range | `empty` |
| --- | --- | --- | --- | --- |
| Initial selection | false | yes | `from: 9, to: 30` | false |
| Prefix insertion | true | no | `from: 25, to: 46` | false |
| Whole-document `setValue` | true | no | `from: 31, to: 0` | false |

The invalid mark was therefore **inverted, not zero-width**. The existing `!range.empty` guard correctly passed a nonempty range; filtering on `from < to` would have hidden the selection rather than preserving it.

The equivalent real `@codemirror/state` 6.7.6 transaction reproduced exactly the same result: after selecting `9→30`, inserting 16 characters at offset zero, and replacing the entire 47-character document with the original 31-character source, `next.selection.main` was `from: 31, to: 0`, `empty: false`. This matched the Obsidian host rather than relying on a guessed host-only workaround.

### Unit RED and minimal fix

A new real-transaction regression in `tests/selection-presentation.test.ts` asserts the inverted remapped values and requires one decoration normalized to `0→31`.

RED command:

```bash
npx vitest run tests/selection-presentation.test.ts
```

RED result: **1 failed / 8 passed (9 tests)**, throwing the same `RangeError` at `Decoration.mark().range(31, 0)` in `src/selection-presentation.ts`.

The minimal root-cause fix keeps the empty-range filter and passes `Math.min(range.from, range.to)` and `Math.max(range.from, range.to)` to `Decoration.mark().range()`. This preserves reversed/multiple/whitespace selections and does not mutate editor selection or document state.

GREEN result from the same command: **1 file / 9 tests passed**. Runtime fix commit: `cd175711e57624d4908e5375d240712d3637b4a2`. RED/GREEN logs are retained in the Task 5 SDD workspace.

## Local gates

Final runtime commands from the worktree:

| Command | Result |
| --- | --- |
| `npm test` | **53 files / 1,750 tests passed** |
| `npm run build` | Strict TypeScript and production esbuild passed |
| `npm run lint` | Passed with no findings |
| `git diff --check` | Passed |
| `sha256sum main.js` | `72a2627dc33cd0dc37b7cd47745d5bbdbe8591101e468ea6dc11538a92e65c61` |

The initial pre-fix gate was **53 files / 1,749 tests** with bundle `e97ca96106c0c5956518225779500b54f09cc655797063b6e610dbc665690740`. The final runtime hash above, not a documentation-only build, was used for every final Obsidian matrix.

## Real-Obsidian verification

Runtime: official Obsidian **1.15.0** AppImage, isolated Linux/Xvfb `:101`, CDP `19224`, synthetic notes, local OpenAI-compatible SSE/Search/Fetch mocks at `127.0.0.1:18766`, and dummy SecretStorage credentials. Root and loaded bundle hashes matched in every summary. No real account, provider, credential, external Emend retrieval, paid call, or non-test vault was used.

### Final matrices

| Command | Result |
| --- | --- |
| `node test_vault/emend-selection-chat-verify/verify.mjs` | **38 scenarios / 724 assertions passed** for complete 00–37 |
| `node test_vault/emend-selection-chat-verify/verify.mjs --selection-highlight` | **12 scenarios / 132 assertions passed** |
| `node test_vault/emend-selection-chat-verify/verify.mjs --compact` | **1 scenario / 28 assertions passed** |
| `node test_vault/emend-selection-chat-verify/verify.mjs --stale-only` | **1 scenario / 9 assertions passed** |
| `node test_vault/emend-selection-chat-verify/verify.mjs --picker-regressions` | **2 scenarios / 25 assertions passed** |

The standalone focused run before the presentation fix also passed **10 scenarios / 143 assertions** for scenarios 28–37; those same scenarios passed again inside the final complete matrix on the fixed bundle.

Historical scenario numbers 00–27 remained stable. Scenarios 06 and 21 were migrated from the retired flat picker to the current Related-notes explorer helper without removing their request/privacy/capacity assertions. Scenario 21 restores generous capacity after asserting its exact tight-capacity rejection so the retained ready user message's subsequent history inclusion cannot prevent the original pending-release/cleanup checks. No assertion was weakened.

### Appended Selection-focus scenarios

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 28 selection-focus-menu-state-popout | 11 | Eight-item menu, disclosures, per-view/session state, actual-note reset, owner-document popout, zero requests/writes |
| 29 chat-selection-complete-focus | 10 | Ordinary bounded control, complete full-note/focus sections, multiline Unicode over-budget selection, privacy, zero writes |
| 30 chat-selection-fail-closed-web | 38 | Empty/whitespace/vanished failure, Review consent, Review/Auto focused Fetch rounds, writer-free terminal answers |
| 31 default-smart-symmetric-context | 7 | Byte-level Default Smart and Stage 09 Symmetric controls |
| 32 full-note-selection-typed-native-undo | 12 | Structured prompt, originating-session history, exact markup, confined native replacement, undo/redo |
| 33 full-note-selection-quick-outside | 30 | All quick actions exactly once, Web off, outside-target correction rejection with zero writes |
| 34 selection-focus-capacity | 9 | Full-note/focus duplicate accounting and exact-boundary Chat/Edit blocking |
| 35 modify-selection-full-note-context | 12 | Default reset, disclosure, pending disabling, empty history, exact native edit |
| 36 selection-focus-stop-stale-lifecycle | 11 | Session retention, Stop/retry, stale source and target-note abort/isolation |
| 37 selection-focus-240-layout | 3 | Both focused summaries, accessible names, controls and no overflow at 240 px |

Request assertions parse structured Active-note Markdown, full-note, focus/target, context, and User message sections rather than relying on global substring counts. They inspect actual wire history/tool rounds, persistence exclusions, native offsets, exact note bytes, and both writer logs.

### Inspected screenshots

Final fixed-bundle images were opened and inspected:

- `29-chat-selection-ready.png`: live selection, Chat Selection summary, ready answer, reasoning, usage, and no focus-preview widget.
- `32-full-note-selection-edit-ready.png`: full-note Selection choice, `Target: Selection.`, model summary, and Edit-only quick actions.
- `35-modify-selection-full-note-pending.png`: visible Full note selector/disclosure and disabled pending controls after dismissing the capacity tooltip.
- `37-full-note-selection-240.png` and `37-chat-selection-240.png`: complete accessible summaries and required controls at 240 px without horizontal overflow; Chat correctly hides quick actions.

Evidence remains ignored under `test_vault/emend-selection-chat-verify/evidence-full-selection-focus/`, `evidence-selection-highlight-acceptance/`, `evidence-compact-selection-focus-final/`, `evidence-stale-diagnostic/`, and `evidence-picker-regressions/`.

## Limits

Verification used Linux/Xvfb, official Obsidian 1.15.0, default test themes, CDP-driven interactions, and loopback mocks only. macOS, Windows, physical OS-level Ctrl/Cmd input, screen readers/assistive technology, other Obsidian versions, and real providers/accounts were not exercised. No real-provider smoke or paid verification is claimed. Controller-owned independent review, push, PR, and CI are outside this local evidence record.
