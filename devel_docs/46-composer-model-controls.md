# Stage 46: Composer model controls

## Status and scope

Composer model controls are implemented on `feat/2.10-composer-model-controls`. Tasks 1–4 were verified at product HEAD `f4bb3b8f469a19de1233e005e01b8f4104aa493a`; the final whole-branch fix wave added serialized settings saves, updater rebasing, stable Settings object identities, blank-current reasoning guards, and trimmed Settings model identity. The compact composer provides provider, model, and reasoning selection without changing the request coordinators, OpenAI-compatible streaming transport, conversation schema, capacity formulas, Web capability boundary, or guarded writers. No release-version claim is included.

- `provider-model-options.ts` supplies each provider's built-in options, then cached discovered models, then the trimmed current model, deduplicated by exact trimmed ID while retaining the first label. DeepSeek has `deepseek-flash` and `deepseek-v4-pro`; Kimi has `k3.1-pro`; Custom has no built-in model.
- `chat-model-control.ts` owns the native button between **Writing and web search** and Send/Stop. Its closed summary is `<catalog provider label> · <trimmed model> · <Low|Medium|High>`, or `<catalog provider label> · <effort>` when the model is empty. The full summary is also the tooltip and part of `Provider, model, and reasoning: …`; long visual text ellipsizes without truncating the DOM text or accessible name.
- The menu contains disabled DeepSeek, Kimi, and Custom group headings. Each group lists its model options and Low/Medium/High reasoning items, with checks only for the active provider's current model and effort. Every provider's reasoning items and callbacks are disabled whenever its trimmed current model is empty, even when built-in or discovered model choices remain enabled. Empty Custom also shows disabled **No model configured**. The menu uses the trigger's owner document, closes on rerender/view close, and ignores stale or disabled callbacks.
- `model-discovery.ts` is used only by the explicit **Settings → Emend → Refresh models** action. It makes one authenticated `GET <base URL>/models`, validates and deduplicates the returned list, preserves the previous list on failure, and sanitizes errors. Composer open/selection never invokes discovery. Custom model text remains editable in Settings; the composer is not a free-text model editor.
- `chat-view.ts` supplies one updater to `saveSettings()` per choice. When that queued save executes, the updater clones the latest top-level settings, providers object, and selected provider only, changing `activeProvider` plus that provider's `model` and `reasoningEffort`. `main.ts` serializes every no-argument, object-candidate, and updater save through one plugin-level queue that continues after rejection. It sanitizes and persists before applying values into the existing root settings, providers, and per-provider config objects, then refreshes every open chat view's model control and capacity estimate. A successful updater is reapplied to the latest live state at commit so direct Settings edits made while its disk write was pending survive. Secrets, base URLs, discovered-model caches, capacity pairs, other providers, and unrelated settings are preserved; no documented capacity default is applied. Settings dropdown identity uses the same trimmed current-model ID as the shared options.

## Pending, failure, and preserved-state behavior

The model-saving flag is set synchronously before the save await. It disables the model trigger, Writing/Web trigger, Send, and quick actions; typed submission, quick actions, Enter, and Mod+Enter are refused before context capture, messages, persistence, provider calls, or writes. The textarea remains editable. Request streaming, thread loading, and session mutation also disable model selection, and Stop/settlement restores the enabled state.

A rejected save shows `Emend: Could not save model settings. <error>`, leaves the prior live values, object identities, and summary unchanged, performs no cross-view refresh, and permits a one-save retry. The queue continues with later saves. Settlement clears the view-local pending flag before refreshing controls and capacity. A closed view performs no settlement render or refresh.

Selection uses targeted control updates rather than a full composer render. Drafts, caret/focus, active sessions and messages, note targets, Related-note selections, Chat/Edit, explicit/automatic Edit targets, and per-view retained Web choices survive. A successful Settings save updates all open views to the same global active provider while preserving their independent composer state. Because successful saves retain object identities, an already-open Settings tab and in-flight discovery continue against live configuration rather than detached objects. Actual reload restores sanitized settings and ready conversations only; drafts, Related-note selections, and per-view Writing/Web choices remain transient.

Chat Review/Auto stays selected when the active provider or model changes. Kimi, Custom, and unsupported DeepSeek models still fail at submission with exactly `Online search is only available for DeepSeek deepseek-flash and deepseek-v4-pro.` and make no ordinary unsearched fallback request. Selecting a supported DeepSeek model permits a normal retry with the existing Web declarations. Edit targets and Edit-only quick actions retain their existing behavior, and model selection alone never submits or writes.

## Privacy and safety boundaries

Opening, checking, or dismissing the model menu performs no settings save, provider request, model discovery, note-content read, or note write. An actual model/effort selection performs exactly one queued, sanitized local settings save and no network or note I/O. Selecting a provider does not read its API key or base URL for networking and does not alter either value. Every persisted provider `apiKey` remains empty; credentials stay in their existing SecretStorage entries.

Only an explicit later chat/edit submission uses the chosen model and `reasoning_effort`. Control-only checks are distinct from intentional submissions in the runtime matrix. Chat remains writer-free, full-note Edit retains its guarded vault writer, Selection retains one native editor replacement, and no new provider, retry, fallback, persistence, or writer path exists.

## Local verification

Fresh commands from the repository root on 2026-11-15 (Asia/Shanghai):

| Command | Result |
| --- | --- |
| `npm test` | **51/51 Vitest files, 1,680/1,680 tests passed**; duration 4.45 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | `b6d546a2c888c754464cf64af511178231f17a0ff3441c15ab8fc34041a70498`. |

The ignored loopback harness copied this exact production bundle into the isolated runtime vault. Its startup assertion and the final explicit `sha256sum` comparison confirmed root/loaded bundle equality.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic notes, and the local OpenAI-compatible SSE mock at `127.0.0.1:18766`. Every provider base URL was loopback and every SecretStorage value was a distinct dummy string. No real provider, account, credential, external Emend request, paid call, or other vault was used.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --model-controls
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Results:

- Focused model controls: **10/10 scenarios, 119/119 assertions**, generated `2026-11-15T05:54:21.275Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-model-controls-final-fix-complete/summary.json`.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-15T05:54:32.892Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-compact-model-controls-final-fix-complete/summary.json`.
- Combined: **11/11 scenario runs, 147/147 assertions**, with no failed scenario in either final complete run. Earlier incomplete harness-correction runs are not included in these totals.

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Menu/groups/empty Custom | 11 | Exact initial summary/tooltip/accessible name and row position; built-in/discovered/current groups and checks; disabled headings; reasoning entries; empty-Custom behavior; one local save; zero requests/content reads/writes; unchanged dummy secrets. |
| 02 Selection/persistence/wire requests | 25 | DeepSeek v4-pro, Kimi Low reasoning, and long Custom selection with one save each; whole persisted-settings comparisons; sanitized keys and unchanged secret/base-URL/cache/capacity/other-provider values; actual mock `model` and `reasoning_effort` fields; no selection-originated request or write. |
| 03 Unsupported Web/Edit/quick action | 8 | Retained Review and Auto across unsupported provider/model changes; exact capability error with zero fallback; supported v4-pro retry with both Web declarations; retained Edit Selection and quick actions; one intentional Kimi quick-action request and native replacement. |
| 04 Pending/failure/lifecycle | 17 | Deferred-save disabling, editable/preserved draft, Enter/Mod+Enter and quick-action refusal, exact failed-save Notice and unchanged live settings, retry, Stop/request/thread/session pending states, rerender/close menu cleanup, zero cleanup requests/content reads/writes. |
| 05 Two-view label/capacity refresh | 9 | One save refreshed both open views; distinct existing DeepSeek/Kimi/Custom effective capacities 7,200/5,400/3,600; unchanged per-view known-input estimates; no automatic documented defaults or control-originated I/O. |
| 06 Preserved state/actual reload | 7 | Both views preserved drafts/caret/focus, sessions/messages, target, Related notes, Writing/Web and Edit-target state across selection; after actual reload, explicit target reopen, and explicit reopen of the one custom chat leaf this runtime did not reinstantiate, both views loaded sanitized settings and ready conversations while transient drafts/Related/Writing/Web state cleared. |
| 07 Popout/long name/240 px themes | 7 | Supported popout owner-document menu, full long-Custom tooltip/accessibility, 240 px dark/light layout without horizontal overflow, and zero requests/content reads/writes. |
| 08 Open Settings identity/subsequent edits | 9 | Composer selection preserved root/providers/config identities captured by the real Settings renderer; later base-URL/cache/history edits persisted with the selected model/effort, sanitized keys, and zero provider/note I/O. |
| 09 Two views overlapping Settings saves | 11 | A held first disk write serialized two view selections and two no-argument Settings edits; both pending flags remained set, the second updater rebased, final values retained both selections and later edits, and identities/credentials/note bytes remained intact. |
| 10 Blank-current reasoning | 15 | DeepSeek/Kimi built-ins and discovered-only Custom kept valid model items enabled while every blank-current effort item/callback was disabled; valid selections still saved once, with zero provider/note I/O. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web choice, both Edit targets, Edit-only quick-action visibility, Related-notes details and focus, draft/caret/focus preservation, lifecycle/popout behavior, zero non-submission requests/reads/writes, and the new interactive model summary.

## Screenshot inspection

The following ignored images were opened and visually inspected, not merely checked for existence:

- `test_vault/emend-selection-chat-verify/evidence-model-controls-final-fix-complete/screenshots/model-controls-240-dark.png`: the long Custom button ellipsizes within the 240 px dark sidebar, wraps independently of Writing and Send, and leaves all three Edit quick actions visible without horizontal overflow.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-final-fix-complete/screenshots/model-controls-240-light.png`: the same full long-name control and compact layout remain bounded and legible in the real light theme.
- `test_vault/emend-selection-chat-verify/evidence-compact-model-controls-final-fix-complete/screenshots/00-compact-composer-controls-lifecycle-popout.png`: the adjacent compact flow ends with Chat, Related notes, the interactive `DeepSeek · deepseek-flash · High` control, and Send in their expected compact positions.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-final-fix-complete/screenshots/model-08-open-settings-identity-and-subsequent-edits.png`, `model-09-overlapping-two-views-and-settings-saves.png`, and `model-10-blank-current-reasoning-all-providers.png`: the post-settlement composer remains usable with the expected selected DeepSeek/Kimi/Custom summaries; no unexpected dialog, provider error, or note modification is visible.

## Verification limits and concerns

- Linux/Obsidian 1.15.0 with Xvfb was exercised. Windows, macOS, other Obsidian versions, window managers, display scales, and platform-specific popout behavior were not exercised.
- Enter/Ctrl+Enter and Escape used trusted CDP-dispatched events, not physical OS-level keyboard input. macOS/Cmd and physical Ctrl input remain unexercised. Accessible names, roles, native disabled states, focus, and ARIA state were asserted programmatically; no screen reader or assistive-technology output was exercised.
- Dark and light default Obsidian themes were exercised at 240 CSS px. No claim is made for every community theme or display scale.
- All model traffic used the local mock and dummy credentials. No real provider/account, external discovery, provider billing, or paid behavior was verified.
- The final reviewer’s detached-Settings, overlapping-save, blank-current reasoning, trimmed-dropdown, and documentation findings were fixed through focused RED→GREEN regressions. Runtime harness corrections accounted for the separate Settings renderer, post-reload instrumentation, four intentional overlapping writes, and one serialized custom chat leaf that Obsidian did not reinstantiate; the final counts above include only complete passing runs. No push, PR, CI, or real-provider verification is claimed.
