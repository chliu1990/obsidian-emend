# Stage 46: Composer model controls

## Status and scope

Composer model controls are implemented on `feat/2.10-composer-model-controls`. The original controls were verified at `f4bb3b8f469a19de1233e005e01b8f4104aa493a`; subsequent fixes added serialized settings saves, updater rebasing, stable Settings object identities, blank-current reasoning guards, and trimmed Settings model identity. PR #64 menu feedback was implemented at `ed78b28706b1c0af431b0930a6a31ceca2ae2e47`, and `f1b8bed1f19f9c3441ec35fe2186dd8ecc2370f5` fixes the queued reasoning-only stale-model case found by the follow-up runtime matrix. `9c03aa0fefd6bd123bb4c22e1e2a6a2df0216ba7` applies the PR width feedback by content-sizing and capping the model trigger. The compact composer provides provider, model, and reasoning selection without changing request coordinators, OpenAI-compatible streaming transport, conversation schema, capacity formulas, Web capability boundary, or guarded writers. No release-version claim is included.

- `provider-model-options.ts` supplies each provider's built-in options, then cached discovered models, then the trimmed current model, deduplicated by exact trimmed ID while retaining the first label. DeepSeek has `deepseek-flash` and `deepseek-v4-pro`; Kimi has `k3.1-pro`; Custom has no built-in model.
- `chat-model-control.ts` owns the native button between **Writing and web search** and Send/Stop. Its closed summary is `<catalog provider label> · <trimmed model> · <Low|Medium|High>`, or `<catalog provider label> · <effort>` when the model is empty. The full summary is also the tooltip and part of `Provider, model, and reasoning: …`; long visual text ellipsizes without truncating the DOM text or accessible name. The base rule uses `flex: 0 1 auto` with `max-width: min(100%, 320px)`, `min-width: 0`, and `margin-inline-start: auto`, so the button sizes to its content, remains right-aligned, and never grows to fill the row. The under-400 px rule remains `flex: 1 1 100%` for the established wrapping behavior.
- The menu has exactly one disabled **Model** section heading followed by available provider groups, one separator, and one disabled **Reasoning effort** heading with a single Low/Medium/High set for the active provider. A provider group appears only when `getApiKey(provider.id).trim()` is nonempty and that provider has at least one built-in, cached-discovered, or trimmed-current model option. Custom therefore appears only with both a key and a usable configured or discovered model. Keyless providers, keyed providers without model options, their headings, and their models are omitted; the old empty-Custom placeholder is not shown. If no provider qualifies, **Model** contains only disabled **No available models**, while the active-provider reasoning section remains separate.
- Availability reads only the existing SecretStorage-backed provider IDs `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom` through the plugin's synchronous `getApiKey()` path. The IDs are not secrets, and no credential value is written to `data.json`, shown in the menu, or sent by opening it. Adding or removing a key through real Settings uses `setApiKey()` and the existing sanitized `saveSettings()` path, refreshes every open view's availability and capacity, clears that provider's discovered-model cache, and performs no model discovery or other provider request.
- Model groups retain built-in then cached-discovered then trimmed-current order and exact-ID checks only for the active provider's current model. Only the active provider's effort is checked. Every effort item and callback is disabled when the active provider's trimmed current model is blank, while valid model items remain enabled. Model selection preserves that provider's stored effort. Reasoning selection changes only the active provider's effort and carries no model ID, so its queued updater retains the latest current model rather than restoring a model captured before an overlapping save.
- Every successful Settings save closes an open model menu during targeted refresh. Detached menu items, rerendered or closed views, disabled items, and other stale callbacks are inert. The menu uses the trigger's owner document in popouts and closes on rerender/view close.
- `model-discovery.ts` is used only by the explicit **Settings → Emend → Refresh models** action. It makes one authenticated `GET <base URL>/models`, validates and deduplicates the returned list, preserves the previous list on failure, and sanitizes errors. Composer open/selection and key-based availability refresh never invoke discovery. Custom model text remains editable in Settings; the composer is not a free-text model editor.
- `chat-view.ts` supplies one updater to `saveSettings()` per choice. Model selection changes `activeProvider`, the selected model, and that provider's preserved effort; reasoning-only selection changes `activeProvider` and its effort while preserving the latest model. The updater clones only the latest top-level settings, providers object, and selected provider. `main.ts` serializes every no-argument, object-candidate, and updater save through one plugin-level queue that continues after rejection. It sanitizes and persists before applying values into the existing root settings, providers, and per-provider config objects, then refreshes every open chat view's model control and capacity estimate. A successful updater is reapplied to the latest live state at commit so direct Settings edits and overlapping model/reasoning choices made while its disk write was pending survive. Secrets, base URLs, discovered-model caches except for an actual key change, capacity pairs, other providers, and unrelated settings are preserved; no documented capacity default is applied. Settings dropdown identity uses the same trimmed current-model ID as the shared options.

## Pending, failure, and preserved-state behavior

The model-saving flag is set synchronously before the save await. It disables the model trigger, Writing/Web trigger, Send, and quick actions; typed submission, quick actions, Enter, and Mod+Enter are refused before context capture, messages, persistence, provider calls, or writes. The textarea remains editable. Request streaming, thread loading, and session mutation also disable model selection, and Stop/settlement restores the enabled state.

A rejected save shows `Emend: Could not save model settings. <error>`, leaves the prior live values, object identities, and summary unchanged, performs no cross-view refresh, and permits a one-save retry. The queue continues with later saves. Settlement clears the view-local pending flag before refreshing controls and capacity. A closed view performs no settlement render or refresh.

Selection uses targeted control updates rather than a full composer render. Drafts, caret/focus, active sessions and messages, note targets, Related-note selections, Chat/Edit, explicit/automatic Edit targets, and per-view retained Web choices survive. A successful Settings save updates all open views to the same global active provider while preserving their independent composer state. Because successful saves retain object identities, an already-open Settings tab and in-flight discovery continue against live configuration rather than detached objects. Actual reload restores sanitized settings and ready conversations only; drafts, Related-note selections, and per-view Writing/Web choices remain transient.

Chat Review/Auto stays selected when the active provider or model changes. Kimi, Custom, and unsupported DeepSeek models still fail at submission with exactly `Online search is only available for DeepSeek deepseek-flash and deepseek-v4-pro.` and make no ordinary unsearched fallback request. Selecting a supported DeepSeek model permits a normal retry with the existing Web declarations. Edit targets and Edit-only quick actions retain their existing behavior, and model selection alone never submits or writes.

## Privacy and safety boundaries

Opening, checking, or dismissing the model menu performs no settings save, provider request, model discovery, note-content read, or note write. An actual model/effort selection performs exactly one queued, sanitized local settings save and no network or note I/O. Selecting a provider does not read its API key or base URL for networking and does not alter either value. Key/model availability refresh likewise performs no discovery or request. Every persisted provider `apiKey` remains empty; credentials stay in their existing SecretStorage entries.

Only an explicit later chat/edit submission uses the chosen model and `reasoning_effort`. Control-only checks are distinct from intentional submissions in the runtime matrix. Chat remains writer-free, full-note Edit retains its guarded vault writer, Selection retains one native editor replacement, and no new provider, retry, fallback, persistence, or writer path exists.

## Local verification

Commands from the repository root on 2026-11-15 (Asia/Shanghai), including the follow-up source fix and this documentation update:

| Command | Result |
| --- | --- |
| `npm test` | **51/51 Vitest files, 1,685/1,685 tests passed**. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | `d1e59f676e2951ca59eda618ec00ebd49f9f555aacbc44445172576bc5a8a1b6`. |

The ignored loopback harness copied this exact production bundle into the isolated runtime vault. Its startup assertion and the final explicit `sha256sum` comparison confirmed root/loaded bundle equality.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic notes, and the local OpenAI-compatible SSE mock at `127.0.0.1:18766`. Every provider base URL was loopback and every SecretStorage value was a distinct dummy string or an intentionally empty key. No real provider, account, credential, external Emend request, paid call, or other vault was used.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --model-controls
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Final results at source commit `9c03aa0fefd6bd123bb4c22e1e2a6a2df0216ba7`:

- Focused model controls: **11/11 scenarios, 146/146 assertions**, generated `2026-11-15T07:14:40.832Z` and preserved with request traces and screenshots in ignored `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/summary.json`.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-15T07:14:45.449Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-compact-width-final/summary.json`.
- Combined: **12/12 scenario runs, 174/174 assertions**, with no failed scenario in either final complete run. Earlier harness-correction and RED runs are not included in these totals.
- Root and loaded production bundle SHA-256: `d1e59f676e2951ca59eda618ec00ebd49f9f555aacbc44445172576bc5a8a1b6` in both runs.

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Separated menu, DeepSeek only | 12 | Real DeepSeek key, empty Kimi key, and model-less Custom produced exactly top-down **Model**, DeepSeek heading/options, separator, **Reasoning effort**, and one active-provider Low/Medium/High set; no Kimi/Custom heading, model, cache, or legacy placeholder; exact checks, summary, accessibility, one save, and zero control I/O. |
| 02 Key/model availability and SecretStorage refresh | 17 | Real Settings added/removed Kimi and Custom keys through the existing save path; availability refreshed without reload or discovery; Custom required key plus configured/discovered model; no-provider state showed disabled **No available models** beside separate active-provider reasoning; stale detached item was inert; sanitized secret-free persistence and zero provider/note I/O. |
| 03 Selection, persistence, and wire requests | 31 | DeepSeek model selection, Kimi model selection preserving Medium, active-Kimi Low reasoning-only selection, and long Custom selection used one save each; whole persisted-settings comparisons, sanitized keys, actual mock `model`/`reasoning_effort`, and no selection-originated request or write. |
| 04 Unsupported Web/Edit/quick action | 8 | Retained Review and Auto across unsupported provider/model changes; exact capability error with zero fallback; supported v4-pro retry with both Web declarations; retained Edit Selection and quick actions; one intentional Kimi quick-action request and native replacement. |
| 05 Pending/failure/lifecycle | 17 | Deferred-save disabling, editable/preserved draft, Enter/Mod+Enter and quick-action refusal, exact failed-save Notice and unchanged live settings, retry, Stop/request/thread/session pending states, rerender/close menu cleanup, zero cleanup requests/content reads/writes. |
| 06 Two-view label/capacity refresh | 9 | One save refreshed both open views; distinct existing DeepSeek/Kimi/Custom effective capacities 7,200/5,400/3,600; unchanged per-view known-input estimates; no automatic documented defaults or control-originated I/O. |
| 07 Preserved state/actual reload | 7 | Both views preserved drafts/caret/focus, sessions/messages, target, Related notes, Writing/Web and Edit-target state across selection; after actual reload, explicit target reopen, and explicit reopen of the one custom chat leaf this runtime did not reinstantiate, both views loaded sanitized settings and ready conversations while transient drafts/Related/Writing/Web state cleared. |
| 08 Wide 567 px/popout/long name/240 px themes | 10 | At a real 567 px sidebar and 543 px action row, ordinary DeepSeek measured 202.890625 px with 250.03125 px unused before it, `flex-grow: 0`, right alignment, and full untruncated text; long Custom measured exactly 320 px with actual ellipsis and full DOM text/tooltip. Supported popout owner-document menu and 240 px dark/light wrapping remained usable without horizontal overflow, with zero requests/content reads/writes. |
| 09 Open Settings identity/subsequent edits | 9 | Composer selection preserved root/providers/config identities captured by the real Settings renderer; later base-URL/cache/history edits persisted with the selected model/effort, sanitized keys, and zero provider/note I/O. |
| 10 Two views overlapping Settings saves | 11 | A held first model write serialized a second view's reasoning-only selection and two no-argument Settings edits; both pending flags remained set, the reasoning updater retained the newly selected model instead of its stale captured model, final values retained every later edit, and identities/credentials/note bytes remained intact. |
| 11 Blank-current reasoning | 15 | DeepSeek/Kimi built-ins and discovered-only Custom kept valid model items enabled while the single active-provider effort set was disabled for a blank current model; disabled callbacks made no save and valid selections still saved once, with zero provider/note I/O. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web choice, both Edit targets, Edit-only quick-action visibility, Related-notes details and focus, draft/caret/focus preservation, lifecycle/popout behavior, zero non-submission requests/reads/writes, and the interactive model summary.

## PR #64 trigger-width RED/GREEN evidence

The existing compact-composer CSS regression was strengthened before the CSS change to require base `flex: 0 1 auto`, `max-width: min(100%, 320px)`, and preserved automatic inline-start margin while retaining the under-400 px `flex: 1 1 100%` assertion.

```bash
npx vitest run tests/chat-view.test.ts -t "wraps the bottom row without shrinking controls"
```

RED: **1 failed, 220 skipped**, with the base rule still showing `flex: 1 1 100px` when `flex: 0 1 auto` was required. The only product changes were the base flex and max-width declarations in `styles.css`. GREEN: the same targeted command passed **1/1 test**, followed by the final **11-scenario/146-assertion** focused and **1-scenario/28-assertion** compact runtime runs. An initial wide harness setup measured a narrow central tab left by the reload scenario; moving the measurement after the existing popout close/reopen restored the actual right sidebar. That harness correction was not a product change and is excluded from final counts.

## PR #64 stale-save RED/GREEN evidence

The new overlapping-view runtime assertion initially failed because a reasoning menu opened during another view's held model save captured the old model ID and its later queued updater restored that stale value. A focused unit regression reproduced the same boundary before any product fix:

```bash
npx vitest run tests/chat-view.test.ts -t "rebases a queued reasoning-only selection"
```

RED: **1 failed, 220 skipped**; the updater returned `Test model` instead of `Model chosen while the effort save was queued`. The minimal fix in `f1b8bed` makes reasoning-only callbacks carry `modelId: null` and retains the latest provider model in the queued updater. GREEN: `npx vitest run tests/chat-view.test.ts tests/chat-model-control.test.ts` passed **239/239 tests**, followed by the full **1,685-test** local gate and the final **11-scenario/146-assertion** focused plus **1-scenario/28-assertion** compact runtime runs above. Earlier scenario failures caused by the old harness's per-provider reasoning and Settings-renderer assumptions were corrected separately and are not counted as product RED evidence.

## Screenshot inspection

The following final ignored images were opened and visually inspected, not merely checked for existence:

- `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/screenshots/model-controls-wide-567-deepseek.png`: comparable to the user's approximately 567 px sidebar, the ordinary `DeepSeek · deepseek-flash · High` button is compact, right-aligned beside Send, and fully readable. It measures 202.890625 px rather than filling the 543 px row, leaving 250.03125 px unused before it.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/screenshots/model-controls-wide-567-long-custom.png`: the long Custom button remains right-aligned, reaches exactly the 320 px cap, and visibly ellipsizes without changing its full DOM text or tooltip.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/screenshots/model-controls-separated-deepseek-only.png`: comparable to the PR feedback, the real menu visibly separates **Model** from **Reasoning effort**, shows only DeepSeek and its three options, and contains exactly one Low/Medium/High set. No Kimi or Custom heading/model is visible; the current model and High effort are checked.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/screenshots/model-controls-no-available-models.png`: disabled **No available models** is the only Model-section entry, with the separate active-provider reasoning choices still visible below it.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-width-final/screenshots/model-controls-240-dark.png` and `model-controls-240-light.png`: the long Custom button ellipsizes within the 240 px sidebar, wraps independently of Writing and Send, and leaves all three Edit quick actions visible without horizontal overflow in both real themes.
- `test_vault/emend-selection-chat-verify/evidence-compact-width-final/screenshots/00-compact-composer-controls-lifecycle-popout.png`: the adjacent compact flow ends with Chat, Related notes, the interactive `DeepSeek · deepseek-flash · High` control, and Send in their expected compact positions.

## Verification limits and concerns

- Linux/Obsidian 1.15.0 with Xvfb was exercised. Windows, macOS, other Obsidian versions, window managers, display scales, and platform-specific popout behavior were not exercised.
- Enter/Ctrl+Enter and Escape used trusted CDP-dispatched events, not physical OS-level keyboard input. macOS/Cmd and physical Ctrl input remain unexercised. Accessible names, roles, native disabled states, focus, and ARIA state were asserted programmatically; no screen reader or assistive-technology output was exercised.
- Dark and light default Obsidian themes were exercised at 240 CSS px. No claim is made for every community theme or display scale.
- All model traffic used the local mock and dummy credentials. No real provider/account, external discovery, provider billing, or paid behavior was verified.
- The follow-up stale-save fix received the local and real-Obsidian verification above, but no separate independent code review was performed for that follow-up. No push, PR update, CI run, or real-provider verification is claimed.
