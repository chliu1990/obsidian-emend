# Stage 44: Compact composer

## Status and scope

The compact composer is implemented and verified on `feat/2.10-compact-composer` at product HEAD `696dc2ab50ec6e614eba60ecc4e3acbfe8632b1c`. PR 1 changes the chat control surface without changing the request coordinators, provider transport, closed Operations protocol, capacity formulas, conversation schema, or guarded writers.

- One accessible **Writing and web search** menu contains **Chat**, **Edit · Selection**, **Edit · Full note**, **Web Off**, **Web Review**, and **Web Auto**. Its closed summary is **Chat**, **Chat · Review search**, **Chat · Auto search**, or the selected Edit target.
- Chat is the only current read-only composer mode and has no writer. The former Discuss/Brainstorm composer choices and separate mode, Edit-target, and Web selectors are not part of the current UI. The Chat/Edit commands and Mod+Shift+A/E defaults remain non-submitting mode switches.
- Web choices are enabled only in Chat. Entering Edit disables all three menu items without discarding the stored Chat Web choice; returning to Chat restores it. Edit and quick-action requests continue to force Web off.
- The active provider/model is a read-only label beside the menu and Send/Stop button, not a composer selector. Model discovery and provider configuration remain in Settings.
- **Related notes** replaces chat's old Additional notes block with a count-bearing trigger and the existing flat Markdown picker. With selections, a native details surface lists full paths in order, per-path **Remove** buttons, **Clear all**, and `Selected note content is sent with your next request.` With none, no details or permanent disclosure is rendered. Modify Selection retains its existing Additional notes control.
- **Fix grammar**, **Make concise**, and **Add examples** are rendered only in Edit. Each follows the maintained displayed target, uses its deterministic prompt, and calls the existing submission path exactly once. Chat does not allocate empty quick-action controls.
- Composer rerenders preserve the draft, selection/caret range, and focus where practical. Rerenders and view close dismiss the owned menu. The menu is shown in the trigger's `ownerDocument`; the real popout scenario exercised a separate document successfully.
- The compact context row and action group wrap without horizontal overflow at 240 CSS px. The capacity bar remains directly after the compact header, followed by session controls and messages; there is no composer capacity meter or compact-context button.

No PR 2/3 behavior or release-metadata change is included or claimed.

## Preserved safety and privacy boundaries

Chat, menu, Related notes, session-management, and lifecycle interactions make no provider request and no note write. Opening the picker, selecting, removing, or clearing Related notes reads no additional-note content; submission resolves and reads selected content freshly. With path sharing off, the provider prompt uses generic numbered labels without additional-note basenames or vault paths.

Full-note Edit retains exactly one guarded `vault.modify` for a changed valid candidate and no native selection replacement. Selection Edit retains exactly one native `editor.replaceRange`, no plugin vault write, exact native undo/redo, and reviewable CriticMarkup. Empty, whitespace-only, or vanished displayed-Selection captures fail closed with no request, message, save, writer call, or Full note fallback. Additional-note-only anchors remain invalid.

Capacity blocking and exact preflight remain terminal before networking. Blocked drafts create no provider request, chat message, persistence mutation, or note write. An additional-note snapshot excluded from the draft estimate can still make exact preflight reject; only the ready local user prompt persists. Later Web and Edit-correction growth fails without a partial answer or write, and succeeds only after capacity is raised.

Ready conversations retain only sanitized schema-3 content. Raw candidates, rejected summaries, diagnostics, selection/note snapshots, additional-note content, drafts, loading/error/stopped states, credentials, and transient Web/reader artifacts remain absent.

## Local verification

Fresh commands from the repository root on 2026-11-14 (Asia/Shanghai):

| Command | Result |
| --- | --- |
| `npm test` | **48/48 Vitest files, 1,589/1,589 tests passed**; duration 4.23 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | `ec1ac350d032eb064b4d7edac6f3704e2dc6ed7bf51913101ec7f560e2e26777`. |

The runtime-vault bundle hash matched the root production bundle. The harness asserts equality before startup; both evidence summaries record the same HEAD and hash.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic notes, the existing local OpenAI-compatible SSE/Search/Fetch mocks at `127.0.0.1:18766`, and a dummy SecretStorage credential. No real provider account, real credential, paid request, or non-loopback Emend retrieval was used. Obsidian's own isolated application log records its standard updater check/download; that traffic was not an Emend provider or Web request.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Results:

- Full matrix: **28/28 scenarios, 581/581 assertions**, summary generated `2026-11-13T18:02:09.214Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-backup-1794592930284-hyn2to/summary.json` after the subsequent sessions run rotated the evidence directory.
- Sessions matrix: **9/9 scenarios, 156/156 assertions**, generated `2026-11-13T18:02:33.509Z` in ignored `test_vault/emend-selection-chat-verify/evidence/summary.json`.
- Combined: **37/37 scenario runs and 737/737 assertions**, with no failed scenario.
- A separate partial invocation was discarded after another full-then-sessions invocation rotated the shared runtime/evidence directories and reused Xvfb/CDP. The results above come only from the later complete runs, not from stitching together partial output.

### Compact, editing, privacy, and capacity matrix

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 00 Compact controls/lifecycle/popout | 28 | Exact six-item menu, Chat Review/Auto summaries, both Edit targets, retained Chat Web state, read-only model, Edit-only actions, Related notes count/details/remove/Clear and focus, draft/caret/focus preservation, rerender/close dismissal, owner-document popout, zero requests/reads/writes. |
| 01 Typed multiline/native undo | 17 | Shift+Enter newline, Enter submission, complete multiline Selection request, one request/native replacement, exact undo/redo, CriticMarkup and untouched surrounding Unicode. |
| 02 All quick actions | 33 | Each action used its exact prompt and displayed Selection target, submitted once, made one native edit, and retained concise results. |
| 03 Full-note override/keyboard | 8 | Ctrl+Enter, explicit Full note despite live selection, one vault write, no native replacement, exact target summary. |
| 04 Empty/whitespace/vanished fail-closed | 13 | Every failure made no request/message/save/write and preserved note bytes. |
| 05 Over-budget complete Selection | 10 | Complete 1,359-character selection, marked bounded surrounding context, one native replacement, intact suffix. |
| 06 Related-note privacy | 13 | No pre-submission content read/request, one submission-time read, generic path-off prompt, unchanged additional note, native active-note writer only. |
| 07 Invalid-to-valid correction | 12 | Exactly one correction with original request and bounded diagnostics, one native edit, all-round usage, successful-only reasoning/summary. |
| 08 Stop/retry | 9 | Stopped response wrote nothing; fresh retry succeeded once with ready-user history only. |
| 09 Stale source/retry | 9 | Exact stale error preserved the synthetic user edit; no stale model replacement; retry behavior retained. |
| 10 A/B target switch | 9 | A aborted without a late write, automatic targeting recomputed for B, B completed independently, A stayed exact. |
| 11 Unchanged Modify Selection modal | 10 | No composer menu/target controls or chat/usage result; one history-free native Selection edit. |
| 12 Narrow sidebar | 4 | At 240 px, Writing/Web, Send, read-only model, Related notes, and all Edit actions remained visible without horizontal overflow or legacy selects. |
| 13 Quick-action failure/visible state | 19 | Vanished Selection failure preserved draft and retained Chat Auto, made no request/message/thread/write; next Full note Edit used Web off and one vault write. |
| 14 Comment-only result | 11 | Zero-change comment retained exact CriticMarkup, target/line summary, reasoning, and one native replacement without leaking comment text. |
| 15 No-op result | 7 | Optional summary rendered without target/bullets and made no writer call or byte change. |
| 16 Persistence/privacy audit | 147 | Schema-3 ready-only messages, concise Edit results, exact summaries/usage/reasoning, no credentials/raw artifacts/snapshots/drafts/transient states, no modal/fail-closed/additional-note thread. |
| 17 Configured history | 22 | Originating-session Chat history reached Selection and Full note requests with correct annotations; zero history disabled earlier messages. |
| 18 Capacity meter states | 50 | Compact-header placement, exact categories/arithmetic/colors, hover/focus/pinning/Escape, live typing/target estimates, output shrinkage, unconfigured state, no composer meter. |
| 19 Capacity freshness | 6 | Caret-only and typed editor changes refreshed estimates without unintended writes; undo restored the estimate. |
| 20 Over-capacity blocking | 14 | Send/Edit actions disabled, Enter/Ctrl+Enter consumed with exact notice, zero requests/messages/persistence/writes. |
| 21 Exact additional-note preflight | 12 | Passing draft rejected after fresh content assembly, no provider request/answer/write, ready user only, pending state released. |
| 22 Capacity/no-write/native undo | 21 | Allowed Full note/Selection writes stayed target-specific; blocked versions did nothing; native undo/redo stayed exact. |
| 23 Web-round growth | 17 | Later transport guard stopped before the oversized fetch round, preserved no partial answer/write, and recovered after raising capacity. |
| 24 Correction growth | 15 | Oversized correction stopped after the first candidate with no write/persisted candidate; corrected retry succeeded after raising capacity. |
| 25 Settings live reload | 23 | Valid/invalid capacity persisted and refreshed without reload, actual reload restored both, keyboard blocking worked, fixed settings recovered. |
| 26 Modal and narrow capacity | 28 | Modal blocking/enabled keyboard submission and one native edit; 240 px chat/details/actions fit; narrow Chat answer wrote nothing. |
| 27 Documented defaults | 14 | Exact DeepSeek/Kimi values, live input/meter updates, Kimi caveat, custom unsupported state, zero metadata fetches. |

### Session matrix

The separate nine scenarios contributed 156 assertions covering missing/transient first Chat; three-session drafts and actual isolated wire history; manual/automatic/stopped/error titles; delete/fallback and actual reload; sanitized schema-3 Edit/Web/usage/reasoning restore; schema 1/2 lazy migration, exact malformed backup, and future-version refusal; Stop/retry/note-switch abort and same-note/different-note locks; originating-session Full note/Selection writes and native undo; active-session capacity/Web/privacy; 240 px session controls; and native keyboard New/Rename. Management made zero provider calls and no unintended note writes.

## Screenshot inspection

The following ignored images from `test_vault/emend-selection-chat-verify/evidence-backup-1794592930284-hyn2to/screenshots/` were opened and visually inspected, not merely checked for existence:

- `pr1-chat-before.png`: Chat summary, no quick actions, Related notes zero count, read-only model label, preserved selected draft text.
- `pr1-chat-after.png`: **Chat · Auto search** summary with the same draft and compact action row.
- `pr1-edit-selection-before.png`: six-item menu with Chat and Web Auto checked before target selection.
- `pr1-edit-selection-after.png`: **Edit · Selection**, all three quick actions, preserved draft, read-only model.
- `pr1-edit-full-note-before.png`: Selection checked before the change and all Web items disabled in Edit.
- `pr1-edit-full-note-after.png`: **Edit · Full note** with all quick actions and the same compact layout.
- `12-narrow-sidebar-240-live.png`: actual 240 CSS px sidebar with the Full note trigger, Related notes, quick actions, composer, read-only model, and Send inside the visible bounds; the existing Track Changes notice does not indicate a layout failure.

## Verification limits and concerns

- Popout owner-document behavior was supported and exercised in this Linux/Obsidian runtime. Other window managers, themes, and platform-specific popout behavior were not exercised.
- Linux Ctrl+Enter and blocked Ctrl+Enter were exercised with trusted CDP-dispatched live-composer events, not physical OS-level typing. macOS/Cmd behavior and physical Ctrl keyboard input remain unexercised.
- macOS and Windows were not tested. No screen-reader or assistive-technology session was performed; accessible names, roles, focus, and ARIA relationships were asserted programmatically only.
- No real provider/account/credential, real Web retrieval, provider billing, or paid call was tested. All Emend model and retrieval traffic used local mocks and dummy credentials.
- Screenshot review was performed at the captured Linux/Xvfb size and the 240 CSS px sidebar setting; it is not a claim about every theme, display scale, or platform.
- No production runtime defect was found in the completed matrices. Independent whole-branch review, push, PR, CI, and publication remain controller steps and are not claimed here.
