# Stage 52: Stream Web answers as provisional drafts

## Status and scope

Implemented on `feat/2.10-web-draft-streaming`, stacked on PR #68 head `6ff1dd7`:

| Commit | Contents |
| --- | --- |
| `2978a59` | `feat: forward web draft reset callbacks` — `ReadOnlyStreamCallbacks.onContentReset`, `WebSearchRunOptions.callbacks.onContentReset`, and coordinator forwarding. |
| `84ea7fb` | `feat: stream web drafts and reset on tool calls` — `DeepSeekWebSearchCoordinator` forwards every round's content deltas, resets a tool round's draft, and stops re-emitting terminal content that already streamed. |
| `59e5585` | `feat: show streamed web answers as drafts` — transient `ChatMessage.webDraft`, the muted draft label, the chat-view reset handler, and two CSS rules. |
| `4943150` | `fix: clear web draft state on terminal messages` — the flag is stripped before the ready snapshot is built and at the start of every terminal-failure path. |
| this task | Ignored harness mode, Stage 52 record, `AGENTS.md`/`IMPLEMENTATION_PLAN.md` updates. |

Web Review/Auto now streams each main-model round's answer content as a clearly labelled provisional draft, clears that draft before a tool round reaches Review or retrieval, and promotes the same streamed text unchanged into the ready answer when a round is terminal.

The change is presentation plus one stream-forwarding decision. No provider request shape, tool schema, retry, correction, retrieval budget, extraction/verifier behaviour, capacity accounting, setting, writer, or persistence schema changed; the conversation schema remains **3**.

## Approved provisional-content policy

Stage 48 and the 2.10 design spec explicitly deferred this work: "Do not stream provisional pre-tool Web content in this release. Any proposal to change that protocol requires separate user approval." The user approved that change on **2026-11-17**, and the approved policy shipped here is:

- Web Review/Auto answer content is **provisional until its round is known to be terminal**, and may be streamed to the chat as soon as it arrives.
- Provisional text always carries the exact label `Draft answer — research may continue` (em dash, no period) and muted styling; it is never shown as an unlabelled answer.
- A round that returns any tool calls **clears** the provisional text and label before Review opens or any Search/Fetch executes.
- A terminal round's streamed text is **promoted unchanged** into the ready answer: it is not re-emitted, re-typed, or duplicated.
- Draft text is transient UI text. It is never persisted, never copied to the clipboard, never becomes the ready answer, and never enters a later submission's provider history; the round's own content stays only in that request's tool continuation. Stopped or failed drafts persist nothing.
- Web Off is unchanged: no label, no muted draft class, the existing waiting/streaming behaviour.

The draft label is user-visible copy but changes no user action, so `README.md`, `QUICK_START.md`, and other public guides were left alone.

## Shipped design

### One optional reset callback (Task 1)

`ReadOnlyStreamCallbacks` gained `onContentReset?: () => void`, and `WebSearchRunOptions.callbacks` became `{ onEvent(event): void; onContentReset?(): void }`. `ReadOnlyRequestCoordinator` forwards `submission.callbacks.onContentReset` into the Web coordinator callbacks on its Web branch only. The Web Off branch, `EditSubmission`, and every Selection/Edit callback type are untouched, so no non-Web submission can receive a reset.

### Per-round streaming, reset, and promotion (Task 2)

`DeepSeekWebSearchCoordinator.submit` now:

- forwards **every** provider event (`content` and `reasoning`) from every round through `options.callbacks.onEvent`, instead of filtering to reasoning;
- tracks a round-local `contentEmitted` flag when a `content` event arrives;
- after the round resolves, calls `options.callbacks.onContentReset?.()` **once** when `rawCalls.length > 0`, before the force-terminal check, before `reviewCalls`, and before any tool executes;
- on a no-tool round, emits `{ type: 'content', text: result.content }` only when content did not already stream, so a terminal round that streamed produces exactly the deltas it produced, while a provider that returns aggregated content without deltas still appears once;
- leaves `forceTerminal`, skipped-call accounting, continuation construction, source registration, and the returned terminal `content` unchanged.

### Chat-view label, reset, and promotion (Tasks 3–4)

- `ChatMessage.webDraft?: boolean` is transient. `toPersistedMessage` is already an explicit field allowlist, so the flag cannot be serialized.
- Read-only `onContent` sets `webDraft = true` only when the captured Web mode is not `off`, then appends text and schedules the existing animation-frame render. Web Off never sets it.
- `onContentReset` clears `content`, sets `webDraft = false`, and schedules the same render.
- Loading rendering adds `div.emend-chat-web-draft-label` with the exact copy above, plus `is-web-draft` on the content element, only for a loading message with content and a truthy `webDraft`. Ready, stopped, error, and user rendering are unchanged.
- `delete loadingMessage.webDraft` runs immediately before the ready snapshot is built and as the first statement of the terminal-failure path, so no ready, stopped, or error message (and no persisted snapshot) can carry the flag.
- `styles.css` adds `.emend-chat-web-draft-label { color: var(--text-muted); font-size: var(--font-ui-smaller); margin-bottom: 4px; }` and `.emend-chat-message-content.is-web-draft { color: var(--text-muted); }`.

## Reset timing and the review-frame note

The reset mutates message state synchronously, but the DOM update lands on the next animation frame through the existing `scheduleRequestRender`. Task 3's review flagged this as M4: a harness that reads the DOM inside the review callback would race the frame. The harness therefore waits for the modal to be visible, waits two animation frames, and only then asserts that the label and preamble are gone; it never reads the DOM synchronously from inside the Review path. The per-frame sampler independently proves the same ordering across every captured frame.

## Rejected alternatives

- **Typewriter reveal or client-side pacing of the buffered answer.** It would fake streaming after the fact, add a second scheduling surface beside the real provider stream, and still hide the fact that retrieval is running; the actual deltas are available and cheaper to show.
- **Forcing a terminal round before showing anything.** Forcing `forceTerminal` (no tools) for the first round would show a draft immediately but remove the model's ability to retrieve, which is the point of Review/Auto.
- **Buffering each round and flushing only at the terminal round.** This is exactly the reported all-at-once behaviour; buffering was the defect, not the fix.
- **Unlabelled provisional text.** The approved policy requires the draft to be indistinguishable from an answer only after promotion, so an unlabelled provisional body was rejected as misleading.
- **Persisting or copying the draft, or sending it back as history.** Provisional text would then outlive its round and could be treated as an answer; the flag is transient and stripped on every terminal path, and the clipboard formatter only reads the ready message.

## Behaviour matrix

| Situation | Result |
| --- | --- |
| Web Review, round 1 streams content then one Search | Label plus muted prefix while streaming; at the visible Review modal the label, text, and preamble marker are gone and no Search has executed; after Run, only terminal text, one citation, and usage are ready. |
| Web Auto, same round shape | Same draft, cleared before the first `Searching: …` activity frame; terminal text, citation, and usage promote. |
| Web Auto, zero-tool round | The streamed answer is labelled while streaming and promoted to a ready answer with no label, no citation, and one request. |
| Stop mid-draft | The visible partial text is kept as a `Stopped` message with no draft label, no citation, no usage, and no persisted assistant message. |
| Web Off | Normal streaming with no draft label and no `is-web-draft` class; the ready answer is unchanged. |
| Copy (ready) | Exact terminal answer plus the registered `### Sources` list; never the draft. |
| Persistence (schema 3) | Ready assistant content equals the terminal answer; no `webDraft`, draft label, or draft/evidence text appears in the stored bytes. |

## RED → GREEN evidence

### Unit (the RED for this feature)

Per the plan's ruling, the unit suites are the RED for Stage 52 and the real-Obsidian harness is GREEN-only; a harness RED would only restate that a brand-new UI does not exist. The TDD sequence was:

| Task | RED | GREEN |
| --- | --- | --- |
| 1 — callback plumbing | New forwarding/control tests failed before the callback existed. | `tests/request-coordinator.test.ts` + `tests/web-search.test.ts` passed. |
| 2 — stream and reset | New content-then-tool, terminal-streamed, fallback, zero-tool, and call-limit cases failed while content was buffered and reset was never called. | `tests/deepseek-web.test.ts` + `tests/request-coordinator.test.ts` passed, including every pre-existing Web scenario. |
| 3 — chat view | `tests/chat-view.test.ts` + `tests/chat-sessions.test.ts`: **3 failed / 297 passed** (missing CSS rule, missing label, missing reset/flag snapshots). | **2 files / 300 tests passed**; the review fix wave (`4943150`) raised it to **302**. |

Two temporary local reverts in the fix wave confirmed the behavior pins rather than tautologies: removing `scheduleRequestRender` from `onContentReset` failed the reset test, and removing both `delete loadingMessage.webDraft` statements failed the ready, stopped, and error cases.

Final local suite before this task's gates: **53 files / 1782 tests passed**.

### Real-Obsidian matrix (ignored harness)

`test_vault/emend-web-verify/verify.mjs --web-draft` reuses the PR5 structured runner, the MutationObserver plus per-frame sampler, the Writing/Web menu helpers, and the DOM probes, and adds five phases against loopback SSE/Search/Fetch mocks. The mock gained three scenarios: `web-draft` (round 1 streams a preamble and returns one Search; round 2 streams the final answer), `web-draft-no-tool` (one round streams its whole answer), and `web-draft-stop` (streams a preamble, then holds until Stop aborts). The sampler also records, per frame, the draft label text, content classes, the leak marker, and whether the content is a growing prefix of the round text; a phase-specific stop marker keeps the shared retention analysis valid.

`node test_vault/emend-web-verify/verify.mjs --web-draft` exited **0** with **5/5 scenarios and 57/57 assertions** on loaded/root bundle `4e1074f7…`, Obsidian **1.15.0**:

| Phase | Assertions | Draft label samples | Labeled frames with muted style | Labeled frames that are a text prefix | Longest draft frame | Loading frames with preamble but no label | Activity frames with preamble | Ready frames with preamble | Ready/stopped frames with label | Ready | Stopped | Blank ready | Blank stopped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `web-draft-review` | 22 | 124 | 124 | 124 | 79 | 0 | 0 | 0 | 0 | 17 | 0 | 0 | 0 |
| `web-draft-auto` | 11 | 123 | 123 | 123 | 79 | 0 | 0 | 0 | 0 | 19 | 0 | 0 | 0 |
| `web-draft-no-tool` | 9 | 41 | 41 | 41 | 62 | 0 | 0 | 7 | 0 | 7 | 0 | 0 | 0 |
| `web-draft-stop` | 10 | 41 | 41 | 41 | 56 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| `web-draft-off` | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 |
| **Total** | **57** | **329** | **329** | **329** | **79** | **0** | **0** | **7** | **0** | **50** | **7** | **0** | **0** |

The seven `web-draft-no-tool` ready frames are expected: that phase's marker is the answer text itself, so the promoted ready answer legitimately contains it. The phase asserts that those ready frames carry no draft label and that no Review/Auto preamble text leaks.

Assertion groups: **41 control**, **8 draft-provisional**, **8 draft-reset**. `droppedSamples 0`; per-phase CPU throttling rate 20; `ready`/`stopped` samples include the first-frame captures that survive eviction.

What the green run proves, in the order the user experiences it:

- The streaming round shows exactly one label with the exact copy, its content carries `is-web-draft`, and the content color equals the label's `--text-muted` color. The message is still loading, with `Researching the web...` above it and no citation or usage yet.
- With Review open, the label and text are gone, the body has no preamble text, the activity is still the initial `Researching the web...`, and the mock has received one completion and zero Search/Fetch calls — the reset preceded Review and retrieval.
- After Run, the ready answer holds only `WEB_DRAFT_FINAL: the synthetic draft answer cites [S1].`, one `Sources (1)` citation `https://example.test/web-draft`, and a usage footer. Copy equals the answer plus the source list, with no preamble.
- The persisted schema-3 assistant content equals the terminal answer, keeps its citation and integer usage, and the stored bytes contain no `webDraft`, no draft label, no preamble marker, and no extraction evidence.
- Auto clears the draft before the first `Searching: …` activity frame and promotes the terminal text identically.
- The zero-tool round streams under the label, then becomes an ordinary ready answer with no label, no citation, and one request.
- Stop mid-draft keeps the visible partial as the `Stopped` body with no label, no citation, and no usage; the stored thread has no assistant message and no draft text.
- Web Off streams normal content with no label, no `is-web-draft` class, and the unchanged complete answer.
- Every phase leaves the note bytes unchanged; the request audit records 5 scenarios, 13 entries, 0 header violations, and 0 credential leaks.

The first harness run was **4 passed / 1 failed**: the Stop phase passed the full preamble to the shared retention check instead of its short marker, so six stopped frames were misreported as retention failures while the actual stopped DOM text was correct. The harness was corrected (no product change), the failed run was preserved as a rotated `evidence-web-draft-backup-1794887055502-sechvn/`, and the rerun above is the recorded evidence.

### Evidence

Ignored, under `test_vault/emend-web-verify/`:

- `evidence-web-draft/summary.json` — SHA-256 `5a7d5f0bbc4d39e4f2e8065df5c885c07c937bd2c1d33be8b6e8c35ec502d855`.
- `evidence-web-draft/web-draft-evidence.json` — SHA-256 `f3a2036744c2841fa203d365f35051065f57f402294d474c24c3ce64cb009695`; records `passed 5`, `failed 0`, `assertionCount 57`, `scenarioNames`, `obsidianVersion 1.15.0` from the `tools/obsidian` `app.asar` probe, `buildLabel 4943150`, the draft policy and exact label, `bundle { sha256, rootSha256, equal: true }`, per-phase analyses, `sampleCounts`, all assertion details, and `requestAudit`.
- `evidence-web-draft/draft-clipboard.txt` — SHA-256 `9f37b89ece168ad9a038f5c52e5367252d37ce747f368ebd638006577264f206`; the exact copied ready answer and source list.
- `evidence-web-draft/logs/*.json`, `request-log.json`, and `summary.json` per phase.
- Screenshots inspected: `web-draft-streaming.png` (label above the muted preamble in the loading bubble), `web-draft-review-modal.png` (Review open, only `Researching the web...` left behind it), `web-draft-review.png` (ready answer, `Sources (1)`, usage, Copy), `web-draft-auto-streaming.png`, `web-draft-auto.png`, `web-draft-no-tool-streaming.png`, `web-draft-no-tool.png`, `web-draft-stop-streaming.png`, `web-draft-stop.png` (`Stopped` badge with the retained partial draft), `web-draft-off.png`, and `00-settings-default-limit.png`.

## Adjacent compact regression

`node test_vault/emend-web-verify/verify.mjs --compact-ui` exited **0** with **1/1 scenario and 4/4 assertions** on the same bundle `4e1074f7…` (`rootBundleMatches: true`) under Obsidian **1.15.0**: Web Auto renders no large `.emend-chat-web-disclosure`, the Writing/Web tooltip keeps its note-context/direct-Auto/billing/local-activity disclosure, the 240 px composer keeps Web, model, and Send visible without horizontal overflow, and composer height stays 219.5 px for Web Off and Web Auto. Evidence: `evidence-compact-ui/summary.json` (`1527c402…`), `compact-ui-evidence.json` (`a4526b2f…`), and the inspected `compact-ui-240.png` (`6a6f8e76…`).

Because `--web-draft` extends the shared PR5 sampler and analysis, `--web-transition` was rerun on the same bundle as a regression: **7/7 scenarios and 40/40 assertions**, `firstReadyNonempty 6/6`, `blankReady 0`, `blankStopped 0`, `stoppedRetentionFailures 0`, `droppedSamples 0`, 159 ready and 20 stopped samples, `bundle.equal true`. Its evidence reports `obsidianVersion 1.15.1` from the Electron-cache asar fallback described under verification limits; that run's own window title was not re-inspected.

## Unchanged boundaries

- **Provider and Web protocol:** no transport, tool declaration, retry, correction, extraction/verifier, call-limit, or capacity-accounting change. Only which deltas reach the chat changed, plus the optional reset notification.
- **Privacy:** provisional text is content the provider already streamed to Emend; the new label is a constant. No new content is collected, sent, or stored.
- **Persistence:** schema stays 3. The draft flag is transient, and the persisted-thread assertions check for `webDraft`, the label, the preamble marker, and evidence text in stored bytes.
- **Writers:** chat remains writer-free. No `vault.modify`, `editor.replaceRange`, permission check, or Edit/Selection path was touched; Web is still unavailable to Edit and Modify Selection.
- **Settings, styles, scheduling:** no setting changed; only two muted draft CSS rules were added; the existing animation-frame render path, scroll/follow-latest logic, Stop/abort path, and Markdown rendering were reused unchanged.

## Verification limits

- **Platform:** Linux/Xvfb with the pinned Obsidian AppImage under `test_vault/emend-web-verify/tools/obsidian/` only. `app.appVersion` is undefined in this build, so the record uses the `tools/obsidian` `app.asar` version probe (**1.15.0**), and this run's settings screenshot title reads `Settings - vault - Obsidian 1.15.0`. As Stage 48 also noted, an `obsidian-1.15.1.asar` copy from the isolated Electron user-data cache can report `1.15.1` through that fallback (the concurrent `--web-transition` rerun did); the window title and pinned package both identify 1.15.0. No macOS, Windows, other Obsidian version, display scale, or real provider was exercised.
- **Providers:** loopback OpenAI-compatible SSE plus local Search/Fetch/extraction mocks with dummy credentials only. No real account, credential, paid call, or other vault.
- **Renderer delay not applied:** the host `MarkdownRenderer` is unreachable from page scope (`hasRenderer: false`, `rendererDelayed: false`), so the harness runs the same assertions with **20× CPU throttling** instead of a widened render interval; `instrumentationRestored` is `false` only because there was no renderer patch to undo. The draft label lives in the loading branch, which does not use `MarkdownRenderer`, so this limit does not affect the draft assertions; it only means the ready Markdown replacement timing is not widened here.
- **Sampling granularity:** the sampler records at animation-frame and mutation granularity, not every microtask, so a sub-frame draft state could exist unobserved. Every observed frame satisfied the invariants (no unlabelled loading text, no labelled ready/stopped frame).
- **No pixel comparison:** the screenshots above were opened and inspected for the expected label, muted text, cleared Review state, promoted answer, and stopped partial; the harness asserts DOM, computed color, text, and stored bytes, not image diffs.
- **Halting mid-draft:** Stop was exercised with the mock holding the stream open; no long real-provider latency, network stall, or provider error mid-draft was exercised. Error paths are covered by unit tests (`status: 'error'` never renders the label or keeps the flag).
- **PR gate:** the branch stays stacked on PR #68 and no PR was opened from this task.
