# Emend 2.0.0 manual verification

## Environment and method

- Date: 2026-10-30.
- Host: macOS, real Obsidian 1.11.7 (`navigator.userAgent` reported `obsidian/1.11.7`), Emend production bundle, and Track Changes 2.3.0.
- Isolated vault: ignored `test_vault/stage17_vault`; isolated profile: ignored `test_vault/.emend-test-profile-17`; CDP port 9232. The fresh-vault trust prompt was accepted only in this disposable profile.
- Provider: CORS-enabled loopback OpenAI-compatible SSE mock at `http://127.0.0.1:8797/v1`, with dummy credentials. DeepSeek, Kimi, and Custom were all edited to that URL and used distinct mock model IDs. No real account, real key, paid provider call, or other vault was used.
- Actual plugin coordinators, live chat controls, native Obsidian key events, an actual `location.reload()`, plugin disable/enable, native editor undo, and rendered Track Changes panels were exercised. Ignored scripts, fixtures, profiles, request logs, and copied bundles remain under `test_vault/` and are not release artifacts.
- Final evidence command: `node test_vault/verify-stage17.mjs` passed with 45 real mock requests, 29 exact Markdown/structural checks, nine Track Changes panels, nine persisted thread inspections, 34 core scenario records, and nine UI scenario records. The checker also rejected credentials, stopped output, temporary files, and note snapshots in persisted threads.

## Complete release matrix

| Area | Actual evidence | Result |
| --- | --- | --- |
| Provider compatibility | DeepSeek, Kimi, and Custom each completed a real plugin request to the loopback mock with `stage17-deepseek`, `stage17-kimi`, and `stage17-custom`, `stream: true`, `temperature: 0.3`, and high reasoning. DeepSeek/Kimi sent `stream_options: { include_usage: true }`; Custom omitted it by default. | Pass |
| Ask / Discuss / Brainstorm | All three modes streamed their expected content and reasoning. `ModeNote17.md`, `Provider17.md`, and `Stop17.md` remained byte-for-byte unchanged. | Pass |
| Markdown chat UI | Actual rendered Ask output contained bold `Markdown`, internal link `ModeNote17`, rendered math, closed reasoning details, Copy buttons, Ask badges, and ready usage footers. | Pass |
| Full-note CriticMarkup | `FullCritic17.md` became `Alpha {~~beta~>CRITIC_FULL~~} gamma.` with one tracked replacement and a concise Edit result. | Pass |
| Full-note Operations | `FullOperations17.md` became `Alpha {~~beta~>OPERATION_FULL~~} gamma.` through exact JSON operation validation and the same Stage 07/Track Changes path. | Pass |
| YAML / code / math preservation | Both strategies changed only `PRESERVE_TOKEN` in otherwise identical fixtures containing complete YAML, a wiki link, inline math, a fenced JavaScript block with an internal blank line, and display math. All delimiters and content were preserved. | Pass |
| Long notes | Read-only context at the 1,000-character setting was below 1,200 characters including prompt fields, had an omission marker, and omitted the far `END_UNIQUE` marker. Full-note Edit sent more than 10,000 characters including both `BEGIN_UNIQUE` and `END_UNIQUE`, then changed only the end marker. | Pass |
| Sequential edits | Three real Edit requests appended A, B, and C annotations in order. Later request payloads contained the earlier `{++A++}` and `{++B++}` markup; the final note preserved all three. | Pass |
| Invalid / unchanged / comment-only | Invalid prose rejected with `Response reject view differs from the original reject view.` and no write. An unchanged response returned `applied: false`. A valid comment-only response applied with `changeCount: 0` and rendered one comment with zero suggestions. | Pass |
| Selection strategies | CriticMarkup changed only `TARGET` to `CRITIC_SELECTION`; Operations changed only `TARGET` to `OPERATION_SELECTION`. Both produced one live Track Changes replacement card. | Pass |
| Multiline selection and native undo | A two-line selection was sent complete and only its second line changed. A separate native `editor.undo()` restored `Undo TARGET only.` exactly after the single range replacement. | Pass |
| Smart selection context | The over-budget containing paragraph sent exact `Selected text: TARGET` with deterministic `[...]` truncation and no adjacent paragraphs. The resulting file changed only TARGET. The request included the vault/note path only when explicitly enabled. | Pass |
| Symmetric selection opt-out | Disabling smart context produced `Context before` and `Context after` fields with the same exact target and no note-path field. Only TARGET changed. | Pass |
| YAML and fenced-code selection context | Over-budget YAML used marked context truncation without truncating the selected scalar or writing outside it. The complete fitting code fence, internal blank line, both delimiters, and adjacent before/after paragraphs were sent; only the selected code identifier changed. | Pass |
| Stale source / target guards | Delayed full-note responses after a user source edit and after a target-note switch both rejected with `The note changed while Emend was responding. No edits were applied.` A delayed selection edit after an editor change rejected identically. No AI annotation was written in any case. | Pass |
| Stop | The live Stop button aborted a partially streamed Ask response. Chat retained a stopped transient message; local storage and post-reload history contained only the ready user prompt. No note write occurred. | Pass |
| Quick actions | Actual Fix grammar, Make concise, and Add examples clicks each switched to Edit, disabled actions while pending, sent exactly one mapped prompt, wrote the expected single tracked change, and stored only the concise result summary. | Pass |
| Composer shortcuts | Real macOS Enter and Cmd+Enter events each submitted exactly one prompt. Shift+Enter inserted `Draft line\n` without a request. | Pass |
| Mode shortcuts | Real Cmd+Shift+A/E events selected Ask/Edit and preserved `Draft line` with no new chat messages or provider requests. The final 45-request log contains no mode-only submissions. | Pass |
| Instruction / skill reload | The first request contained `SKILL_MARK_ONE` and `RELOAD_MARK_ONE`. After rewriting the vault files without restarting, the next contained only the TWO markers, with the skill marker before the AGENTS marker. | Pass |
| Usage | Live and persisted footers were `Provider usage · 17 total · 12 prompt · 5 completion` and `Estimated usage · 157 total · 127 prompt · 30 completion`. The custom request-usage toggle controlled `stream_options` exactly. | Pass |
| Conversation persistence | Separate first/second note threads restored only their own messages. An actual Obsidian `location.reload()` restored the first thread and both usage footers. Nine schema-1 thread files contained no dummy key, stopped response, preserved-note snapshot, or temp file. | Pass |
| Reload / unload cleanup | Disabling Emend during a delayed Edit left `Unload17.md` as `Alpha beta gamma.`. Re-enabling succeeded with no sending state, active controller, or pending render frame. | Pass |
| Track Changes review | Nine freshly rebuilt live panels had correct note titles and cards for full/selection strategies, preservation fixtures, quick action, comment-only, and invalid/no-card cases. | Pass |

## Platform limits

Exact Obsidian 1.11.4, Windows/Linux Ctrl-key UI behavior, mobile behavior, and physical non-macOS platforms were not available and are not claimed. Ctrl matching is covered by unit tests. Mobile remains unsupported while `isDesktopOnly` is `true`. All available release-matrix checks passed; the three previously recorded minor review items remain deferred to the whole-branch fix wave and did not block verification.
