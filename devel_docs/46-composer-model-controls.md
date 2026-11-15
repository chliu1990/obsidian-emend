# Stage 46: Composer model controls

## Status and scope

Composer model controls are implemented on `feat/2.10-composer-model-controls` and verified at product HEAD `f4bb3b8f469a19de1233e005e01b8f4104aa493a`. The compact composer now provides provider, model, and reasoning selection without changing the request coordinators, OpenAI-compatible streaming transport, conversation schema, capacity formulas, Web capability boundary, or guarded writers. No release-version claim is included.

- `provider-model-options.ts` supplies each provider's built-in options, then cached discovered models, then the trimmed current model, deduplicated by exact trimmed ID while retaining the first label. DeepSeek has `deepseek-flash` and `deepseek-v4-pro`; Kimi has `k3.1-pro`; Custom has no built-in model.
- `chat-model-control.ts` owns the native button between **Writing and web search** and Send/Stop. Its closed summary is `<catalog provider label> · <trimmed model> · <Low|Medium|High>`, or `<catalog provider label> · <effort>` when the model is empty. The full summary is also the tooltip and part of `Provider, model, and reasoning: …`; long visual text ellipsizes without truncating the DOM text or accessible name.
- The menu contains disabled DeepSeek, Kimi, and Custom group headings. Each group lists its model options and Low/Medium/High reasoning items, with checks only for the active provider's current model and effort. Empty Custom shows disabled **No model configured** and disables its reasoning items. The menu uses the trigger's owner document, closes on rerender/view close, and ignores stale or disabled callbacks.
- `model-discovery.ts` is used only by the explicit **Settings → Emend → Refresh models** action. It makes one authenticated `GET <base URL>/models`, validates and deduplicates the returned list, preserves the previous list on failure, and sanitizes errors. Composer open/selection never invokes discovery. Custom model text remains editable in Settings; the composer is not a free-text model editor.
- `chat-view.ts` clones the top-level settings, providers object, and selected provider only. A choice changes `activeProvider` plus that provider's `model` and `reasoningEffort`, then calls the existing `saveSettings(candidate)` exactly once. `main.ts` sanitizes and persists the candidate before assigning it as live settings, then refreshes every open chat view's model control and capacity estimate. Secrets, base URLs, discovered-model caches, capacity pairs, other providers, and unrelated settings are preserved; no documented capacity default is applied.

## Pending, failure, and preserved-state behavior

The model-saving flag is set synchronously before the save await. It disables the model trigger, Writing/Web trigger, Send, and quick actions; typed submission, quick actions, Enter, and Mod+Enter are refused before context capture, messages, persistence, provider calls, or writes. The textarea remains editable. Request streaming, thread loading, and session mutation also disable model selection, and Stop/settlement restores the enabled state.

A rejected save shows `Emend: Could not save model settings. <error>`, leaves the prior live settings and summary unchanged, performs no cross-view refresh, and permits a one-save retry. Settlement clears the pending flag before refreshing controls and capacity. A closed view performs no settlement render or refresh.

Selection uses targeted control updates rather than a full composer render. Drafts, caret/focus, active sessions and messages, note targets, Related-note selections, Chat/Edit, explicit/automatic Edit targets, and per-view retained Web choices survive. A successful Settings save updates all open views to the same global active provider while preserving their independent composer state. Actual reload restores sanitized settings and ready conversations only; drafts, Related-note selections, and per-view Writing/Web choices remain transient.

Chat Review/Auto stays selected when the active provider or model changes. Kimi, Custom, and unsupported DeepSeek models still fail at submission with exactly `Online search is only available for DeepSeek deepseek-flash and deepseek-v4-pro.` and make no ordinary unsearched fallback request. Selecting a supported DeepSeek model permits a normal retry with the existing Web declarations. Edit targets and Edit-only quick actions retain their existing behavior, and model selection alone never submits or writes.

## Privacy and safety boundaries

Opening, checking, dismissing, or selecting from the model menu performs no provider request, model discovery, note-content read, or note write. It performs only the local sanitized settings save described above. Selecting a provider does not read its API key or base URL for networking and does not alter either value. Every persisted provider `apiKey` remains empty; credentials stay in their existing SecretStorage entries.

Only an explicit later chat/edit submission uses the chosen model and `reasoning_effort`. Control-only checks are distinct from intentional submissions in the runtime matrix. Chat remains writer-free, full-note Edit retains its guarded vault writer, Selection retains one native editor replacement, and no new provider, retry, fallback, persistence, or writer path exists.

## Local verification

Fresh commands from the repository root on 2026-11-15 (Asia/Shanghai):

| Command | Result |
| --- | --- |
| `npm test` | **51/51 Vitest files, 1,671/1,671 tests passed**; initial duration 4.50 s. |
| `npm run build` | Strict `tsc -noEmit -skipLibCheck` and production esbuild exited 0. |
| `npm run lint` | ESLint exited 0 with no errors or warnings. |
| `git diff --check` | Exited 0 with no output. |
| `sha256sum main.js` | `fbdc88243e48c13feb05ebcb765337dc9feefe990ddc494a53a9f162bc04336b`. |

The ignored loopback harness copied this exact production bundle into the isolated runtime vault. Its startup assertion and the final explicit `sha256sum` comparison confirmed root/loaded bundle equality.

## Real-Obsidian loopback evidence

Runtime: official Obsidian **1.15.0** AppImage, isolated Xvfb `:101`, CDP `19224`, synthetic notes, and the local OpenAI-compatible SSE mock at `127.0.0.1:18766`. Every provider base URL was loopback and every SecretStorage value was a distinct dummy string. No real provider, account, credential, external Emend request, paid call, or other vault was used.

Commands:

```bash
node test_vault/emend-selection-chat-verify/verify.mjs --model-controls
node test_vault/emend-selection-chat-verify/verify.mjs --compact
```

Results:

- Focused model controls: **7/7 scenarios, 84/84 assertions**, generated `2026-11-15T04:54:10.554Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-model-controls-complete/summary.json`.
- Adjacent compact regression: **1/1 scenario, 28/28 assertions**, generated `2026-11-15T04:54:39.319Z` and preserved in ignored `test_vault/emend-selection-chat-verify/evidence-compact-model-controls-complete/summary.json`.
- Combined: **8/8 scenario runs, 112/112 assertions**, with no failed scenario in either final complete run. Earlier incomplete harness-correction runs are not included in these totals.

| Scenario | Assertions | Verified behavior |
| --- | ---: | --- |
| 01 Menu/groups/empty Custom | 11 | Exact initial summary/tooltip/accessible name and row position; built-in/discovered/current groups and checks; disabled headings; reasoning entries; empty-Custom behavior; one local save; zero requests/content reads/writes; unchanged dummy secrets. |
| 02 Selection/persistence/wire requests | 25 | DeepSeek v4-pro, Kimi Low reasoning, and long Custom selection with one save each; whole persisted-settings comparisons; sanitized keys and unchanged secret/base-URL/cache/capacity/other-provider values; actual mock `model` and `reasoning_effort` fields; no selection-originated request or write. |
| 03 Unsupported Web/Edit/quick action | 8 | Retained Review and Auto across unsupported provider/model changes; exact capability error with zero fallback; supported v4-pro retry with both Web declarations; retained Edit Selection and quick actions; one intentional Kimi quick-action request and native replacement. |
| 04 Pending/failure/lifecycle | 17 | Deferred-save disabling, editable/preserved draft, Enter/Mod+Enter and quick-action refusal, exact failed-save Notice and unchanged live settings, retry, Stop/request/thread/session pending states, rerender/close menu cleanup, zero cleanup requests/content reads/writes. |
| 05 Two-view label/capacity refresh | 9 | One save refreshed both open views; distinct existing DeepSeek/Kimi/Custom effective capacities 7,200/5,400/3,600; unchanged per-view known-input estimates; no automatic documented defaults or control-originated I/O. |
| 06 Preserved state/actual reload | 7 | Both views preserved drafts/caret/focus, sessions/messages, target, Related notes, Writing/Web and Edit-target state across selection; after reload and synthetic-target reopen, sanitized settings and ready conversations restored while transient drafts/Related/Writing/Web state cleared. |
| 07 Popout/long name/240 px themes | 7 | Supported popout owner-document menu, full long-Custom tooltip/accessibility, 240 px dark/light layout without horizontal overflow, and zero requests/content reads/writes. |

The compact regression rechecked the six-item Writing/Web menu, retained Chat Web choice, both Edit targets, Edit-only quick-action visibility, Related-notes details and focus, draft/caret/focus preservation, lifecycle/popout behavior, zero non-submission requests/reads/writes, and the new interactive model summary.

## Screenshot inspection

The following ignored images were opened and visually inspected, not merely checked for existence:

- `test_vault/emend-selection-chat-verify/evidence-model-controls-complete/screenshots/model-controls-240-dark.png`: the long Custom button ellipsizes within the 240 px dark sidebar, wraps independently of Writing and Send, and leaves all three Edit quick actions visible without horizontal overflow.
- `test_vault/emend-selection-chat-verify/evidence-model-controls-complete/screenshots/model-controls-240-light.png`: the same full long-name control and compact layout remain bounded and legible in the real light theme.
- `test_vault/emend-selection-chat-verify/evidence-compact-model-controls-complete/screenshots/00-compact-composer-controls-lifecycle-popout.png`: the adjacent compact flow ends with Chat, Related notes, the interactive `DeepSeek · deepseek-flash · High` control, and Send in their expected compact positions.

## Verification limits and concerns

- Linux/Obsidian 1.15.0 with Xvfb was exercised. Windows, macOS, other Obsidian versions, window managers, display scales, and platform-specific popout behavior were not exercised.
- Enter/Ctrl+Enter and Escape used trusted CDP-dispatched events, not physical OS-level keyboard input. macOS/Cmd and physical Ctrl input remain unexercised. Accessible names, roles, native disabled states, focus, and ARIA state were asserted programmatically; no screen reader or assistive-technology output was exercised.
- Dark and light default Obsidian themes were exercised at 240 CSS px. No claim is made for every community theme or display scale.
- All model traffic used the local mock and dummy credentials. No real provider/account, external discovery, provider billing, or paid behavior was verified.
- No production defect was found, so Task 4 required no source/test RED→GREEN fix. Only ignored harness setup/assertion corrections were needed during verification. Independent task review, whole-branch review, push, PR, and CI remain controller steps and are not claimed here.
