# Stage 48: Keep Web answers visible through final rendering

## Status and scope

The fix is implemented on `fix/2.10-web-response-transition` in two commits over base `18da4c6`:

| Commit | Contents |
| --- | --- |
| `8ea409a` | `test: cover web terminal response continuity` — `tests/chat-view.test.ts` only (252 added lines: seven RED behavioral tests plus three guards). |
| `34b4f2f` | `fix: keep web answers visible through final rendering` — `src/chat-view.ts` only, +6 / −2 in three hunks. |

Emend now seeds a ready or stopped assistant body with its plain answer text synchronously, before the detached Markdown render replaces that element, and it shows `Researching the web...` from submission until the first real Web activity instead of the generic waiting placeholder.

The change is presentation-copy only. No provider request shape, retry, token accounting, Web tool protocol, persistence schema, settings, style, writer, or frame-scheduling code changed. The conversation schema remains **3**.

## Reported symptom

Web Review/Auto answers arrive in one burst (that buffering is intentional: main-model answer content is emitted only from the terminal no-tool round) and the just-finished answer briefly appeared **blank** while final Markdown rendering settled. Separately, the loading bubble showed only `Waiting for a response...` while retrieval rounds were running, so retrieval work was indistinguishable from an answer that had not started.

## Root causes

1. **Empty content element before asynchronous Markdown.** `renderMessageBody` created `.emend-chat-message-content` with no text and then rendered Markdown into a detached element, replacing the placeholder only when the promise settled. Between the ready/stopped render and that replacement the answer element contained zero characters while `pendingMarkdownRenders` was 1–3. The unfixed trace caught exactly that frame: `className "… is-assistant is-ready"`, `contentCount 1`, `contentTextLengths [0]`, `pendingMarkdownRenders 1`. The same shape existed for stopped messages (`… is-stopped`, length `[0]`), including a completed partial answer that had already streamed.
2. **No status before the first activity callback.** A submitted Web request created its transient loading message without `webActivity`. The first activity label only arrives when the model's first tool batch completes, so the initial bubble fell through to `Waiting for a response...` for the whole first round (1200 ms in the fixture, longer with real latency).

## Shipped change

Three hunks in `src/chat-view.ts`:

- The ready/stopped placeholder is created with the answer text already in it:
  `bodyEl.createDiv({ cls: 'emend-chat-message-content', text: message.content })`. The detached `MarkdownRenderer.render`, the `renderGeneration`/`isConnected` guards, and both settlement paths (`replaceWith(renderedEl)` on success, `textContent = message.content` on failure) are unchanged, so exactly one content element remains and no duplicate is created.
- The empty-content loading branch uses `text: message.reasoning || message.webActivity ? '' : 'Waiting for a response...'`. A bubble that already shows reasoning or an activity label no longer also shows the generic waiting placeholder.
- `submitPrompt` gives the transient loading message `webActivity: 'Researching the web...'` when the captured Web mode is not `off` (Edit always forces `off` upstream). The existing `onActivity` handler overwrites that field with the first real activity label.

Web Off keeps its previous placeholder and streaming behavior; that path is an asserted regression control. No message field gained persistence: `webActivity` remains transient and is never serialized.

## Rejected alternatives

- **Buffer the answer text until Markdown is ready.** Rejected: the requirement is that terminal text become visible as plain text no later than the next frame, so buffering would widen the invisible interval it was meant to remove, delay stopped partials, and add a second buffering/scheduling surface beside the intentional Web-level buffering.
- **Change frame scheduling / finalization.** Rejected: the traces located no scheduling defect. Every frame, scroll, follow-latest, Stop, and final-save control passed under 20× CPU throttling, and the blank body was single-hunk DOM construction. Changing animation-frame or finalization behavior without a failing test would be unmeasured scope drift with scroll and Stop risk.
- **Stream provisional pre-tool Web rounds.** Rejected: the release explicitly excludes provisional Web content, and doing it would change the Web protocol plus its privacy and cost profile; it requires separate user approval.

## RED → GREEN evidence

### Unit

`tests/chat-view.test.ts` gained seven behavioral tests that pin the synchronous DOM state, plus three guards:

- Ready answer visible before the Markdown render settles, stopped partial visible before the render settles, plain answer retained when the render rejects, unread-page warning visible before the render settles, activity shown instead of the waiting placeholder, the end-to-end terminal streamed-answer transition, and an initial `Researching the web...` status before the first activity callback.
- Guards: the waiting placeholder still appears for a loading message with neither activity nor reasoning, a failed final save keeps exactly one answer, and a Web Off submission leaves `webActivity` unset.

With the unfixed product the focused file was **7 failed / 241 passed (248)**. After `34b4f2f` it is **248 passed (248)**, and the full suite is **53 files / 1762 tests passed**.

### Real-Obsidian matrix (ignored harness)

The ignored harness `test_vault/emend-web-verify/verify.mjs --web-transition` drives the real compact composer against loopback SSE/Search/Fetch mocks and samples the live DOM with a MutationObserver plus per-frame sampler.

| Run | Bundle SHA-256 | Scenarios | Assertions | firstReadyNonempty | blankReady | blankStopped |
| --- | --- | --- | --- | ---: | ---: | ---: |
| RED (`18da4c6`, unfixed) | `562bbe10…` | 2 passed / 5 failed | 32 passed / **8 failed** | 0/6 | 6 | 1 |
| GREEN (`34b4f2f`, Task 3) | `cc17e0ce…` | 7/7 | 40/40 | 6/6 | 0 | 0 |
| GREEN (`34b4f2f`, this final run) | `cc17e0ce…` | 7/7 | 40/40 | 6/6 | 0 | 0 |

The RED failures were exactly the two `initial-status` and six `terminal-continuity` assertions; all 32 controls passed before the fix, so nothing regressed into GREEN. The GREEN totals are `initial-status` 2, `terminal-continuity` 6, and `control` 32, with **156 ready samples**, 20 stopped samples, `droppedSamples 0`, and `stoppedRetentionFailures 0`.

| Phase | Ready samples | First ready nonempty | First ready length | Blank ready | Stopped samples | Blank stopped | Retention failures |
| --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: |
| auto-long-answer | 21 | true | 14125 | 0 | 0 | 0 | 0 |
| warning | 22 | true | 137 | 0 | 0 | 0 | 0 |
| stop | 0 | — | — | 0 | 20 | 0 | 0 |
| web-off | 21 | true | 34 | 0 | 0 | 0 | 0 |
| single-burst | 22 | true | 45 | 0 | 0 | 0 | 0 |
| reader-position | 22 | true | 14125 | 0 | 0 | 0 | 0 |
| hidden-reveal | 48 | true | 14125 | 0 | 0 | 0 | 0 |

The unfixed run's first ready length was `[0]` in all six ready phases and its first stopped length `[0]`; the final run's stopped partial is the 14-character `STOP_PARTIAL: `, retained in every one of the 20 stopped samples.

Behavior covered by the 32 controls, unchanged by the fix:

- Exactly one final content element holds the long (150-block plus table) answer, with its marker, list blocks, table, `Sources (1)` citation `[S1]`, and usage footer. The Auto phase made two main rounds, one reader request, and one verifier request.
- The unread-page warning (`Emend could not read 2 requested pages. The answer may be incomplete.`) is inside the visible ready content while the real 403-plus-empty-page fetch path runs.
- Stop keeps the streamed partial in the visible body; Web Off never renders Web activity and keeps its original waiting placeholder and complete answer.
- The upward reading position is preserved through completion (`distance 600 → 11417`, header `0.30 px` from the scroller top, answer text added) and the transition makes no duplicate request.
- Deactivating the chat leaf (`hiddenRevealMode: markdown-leaf-activation`) neither aborted nor duplicated the in-flight request; revealing shows the full answer and citation.
- Note bytes are unchanged in all seven phases, and the persisted thread is the current schema-3 aggregate with the complete answer, citation metadata, usage, and no transient research status or raw retrieval artifacts.
- Request audit: 7 scenarios, 23 entries, 0 header violations, 0 credential leaks.

Initial status is now exact: before the first activity the loading body is `bodyText "Researching the web..."`, `activity "Researching the web..."`, `contentText ""`, and the Web phases' activity labels begin with `Researching the web...` followed by the first real activity (`Searching: …`, `Fetching: …`).

### Evidence

Ignored, under `test_vault/emend-web-verify/`:

- `evidence-web-transition/summary.json` (SHA-256 `a606aeeb213df652a2105e5e4df05d58692ad8a3f45ab3ee5be77730dd96b886`) and `web-transition-evidence.json` (`a7bd25b0328f7cf204aca5d45841d5387602707389fcf2698fb121c6433712f5`), plus `request-log.json` and `logs/*.json`.
- Screenshots inspected: `web-transition-auto.png` (rendered long answer with marker, table, and `[S1]`), `web-transition-stop.png` (`Stopped` badge with the retained `STOP_PARTIAL:` text), `web-transition-warning.png`, `web-transition-off.png`, `web-transition-single-burst.png`, `web-transition-reader-position.png`, `web-transition-hidden-reveal.png`, `00-settings-default-limit.png`.
- The RED run is preserved as `.superpowers/sdd/2026-11-16-emend-pr5-web-terminal-response/task-1-red-summary.json` and `task-1-red-evidence.json`; each harness rerun rotates the previous directory to `evidence-web-transition-backup-*` rather than overwriting it.

## Adjacent compact regression

The ignored `--compact-ui` scenario predates the Stage 44 compact composer: it locates the removed `select[aria-label="Web search mode"]`, so against the committed HEAD bundle it fails immediately with `Error: Web mode selector is missing.` It reports 4/4 only against the stale Nov 9 plugin copy still present in the harness fixture, which is not this branch's bundle and was rejected as non-evidence. The ignored scenario was updated to probe the current `.emend-chat-writing-trigger` and `.emend-chat-active-model` controls, to read `webSearchMode` from the live view, to accept the current `Chat · Auto search` summary, and to preserve the old no-disclosure-height intent as an equality check between Web Off and Web Auto composer heights at 240 px; the two disclosure checks are unchanged in substance, and the layout check now also requires the model button. Nothing under `src/` or `tests/` changed.

`node test_vault/emend-web-verify/verify.mjs --compact-ui` then exited **0** with **1/1 scenario and 4/4 assertions** on the same root/loaded bundle `cc17e0ce…`:

- Web Auto (`Chat · Auto search`) renders no `.emend-chat-web-disclosure` block.
- The Writing/Web trigger title keeps the note-context/direct-Auto/billing/local-activity disclosure.
- The 240 px composer keeps Web, model, and Send visible without horizontal overflow.
- Composer height is identical for Web Off and Web Auto (219.5 px), so Web mode adds no bottom-disclosure height.

Evidence is ignored `evidence-compact-ui/summary.json` (SHA-256 `40d0f8aabf3b4db4b8b1cd37d112c054e35def084a42eccb5fbd0b7f70820b7f`) and `compact-ui-evidence.json` (`159558bb9d37b5427ebe26a73b2f58b32ab26c0f66dacf73741a9786fe2b184f`), with the inspected `compact-ui-240.png` (`71c54597d721683f2c681f82af96e03902fb0e550055bf62983efd07eea95dde`). This is the Web harness's compact mode, not the separate `emend-selection-chat-verify` `--compact` 28-assertion matrix recorded by earlier stages.

## Unchanged boundaries

- **Provider and Web protocol:** no transport, tool declaration, retry, correction, extraction/verifier, or capacity-accounting change. The two strings are local DOM text; nothing is sent.
- **Privacy:** no new content is collected or transmitted. The seeded text is the answer Emend already received and would render, and the initial status string is a constant.
- **Persistence:** schema stays 3 and `webActivity` remains transient. The persisted-thread assertion explicitly checks that `Researching the web...` and raw retrieval artifacts are absent from stored bytes.
- **Writers:** chat remains writer-free. No `vault.modify`, `editor.replaceRange`, permission check, or Edit path was touched.
- **Settings, styles, scheduling:** no setting, CSS rule, `requestAnimationFrame` call, scroll/follow-latest logic, or Stop/abort path changed.

## Accepted wording caveat

A Web-on request starts with `Researching the web...` even when the model ends up making **zero** retrieval calls, or while a Review batch waits for user input. In those cases the label is shown until the terminal round replaces it. This replaces the previous always-on `Waiting for a response...` placeholder, which was equally generic but described the wrong thing, and is accepted rather than treated as a defect of this task. The `single-burst` phase records exactly this sequence: `activityLabels: ["Researching the web..."]` followed by a complete ready answer and no retrieval.

## Verification limits

- **Platform:** Linux/Xvfb with the pinned Obsidian AppImage under `test_vault/emend-web-verify/tools/obsidian/` only. This run's settings screenshot (`00-settings-default-limit.png`) shows the window title `Settings - vault - Obsidian 1.15.0`, and the AppImage's bundled `resources/obsidian.asar` reports `1.15.0`; the preserved Task 3 screenshot shows the same title. Tasks 1 and 3 additionally recorded `1.15.1` from an `obsidian-1.15.1.asar` copy in the isolated Electron user-data cache, while this final run's own `obsidianVersion`/`obsidianVersionSource` probe returned `null` because `app.appVersion` is undefined in these builds and no such cache copy was present when it was read. The verified runtime is therefore the pinned 1.15.0 AppImage; no other Obsidian version, macOS, Windows, or display scale was exercised.
- **Providers:** loopback OpenAI-compatible SSE plus local Search/Fetch/extraction mocks and dummy credentials only. No real provider, account, credential, paid call, or other vault.
- **Renderer delay not applied:** `rendererDelayed: false` in both RED and GREEN. `MarkdownRenderer` is unreachable from page scope, so the harness cannot widen the render interval; it instead runs the same assertions with **20× CPU throttling** and a 150-block answer. The fix is proven by the sampled DOM state (every first ready frame nonempty, zero blank samples), but this harness does **not** quantify how long the seeded text stays visible before Markdown replaces it, and one frame per transition is sampled rather than every intermediate microtask.
- **Hidden phase:** hiding only deactivates the chat leaf (`markdown-leaf-activation`) inside the same window; it is not a hidden or minimized OS window, and `instrumentationRestored` is `false` only because there was no renderer patch to undo (CPU throttling was reset to 1 and the sampler stopped).
- **No pixel comparison:** the screenshots above were opened and inspected for the expected answer/citation/Stop state, but the harness asserts DOM and text evidence, not image diffs.
