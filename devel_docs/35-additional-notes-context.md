# Stage 35: Additional notes as context

## Status and scope

Additional-note context is implemented and reviewed through Tasks 1–4. Stage 35 passed the clean local gate and real-Obsidian verification, including the actual note picker and Modify Selection modal in an isolated Xvfb display. Context compression remains deferred and was not exercised.

## Implemented behavior

- **Add notes** uses an explicit vault Markdown picker. The in-memory store keeps ordered selections per active target, deduplicates the active note and repeats, and shares selections between chat and Modify Selection for that target only. Selections survive target switches during the current plugin session, clear on plugin or Obsidian reload, and are never persisted.
- Selected paths remain visible with remove/clear controls and a content-sharing disclosure. Rename updates selected/target paths; open pickers and Modify Selection resolve the captured target `TFile`'s live path, and controls close their owned picker on destroy. Delete removes deleted included paths. A missing path fails the whole capture before selected-note reads, instruction reads, or networking.
- Submission captures the target's path array before the first await, then resolves and reads fresh selected-note snapshots. No additional-note content is read or sent by picker/open/note-switch actions.
- Additional notes use a separate combined `maxContextCharacters` source budget. Each note receives `floor(remaining budget / remaining notes)`; included source characters are subtracted and unused capacity rolls forward. Prefix truncation ends with `[...]`. Labels, fences, and markers are additional to source-character accounting. Each snapshot's outer prompt fence is longer than its longest backtick run.
- Prompt sections are separately numbered and explicitly read-only. With **Include note path** off they contain no path label or path metadata; with it on they contain `Path: <vault>/<note path>`. Note content itself is preserved within the captured budget, and active-note path behavior is unchanged.
- Additional-note snapshots are context in every mode, never edit targets. Full-note Operations compile only against the active note and selection Operations only against the captured selection. Additional-note-only anchors fail with zero writes.

## Verification environment

- Date: 2026-11-05, Asia/Shanghai.
- Platform: Linux x86_64; Node.js 20.19.2 and npm 9.2.0.
- Obsidian: official Linux AppImage 1.15.0, extracted and run only from ignored `test_vault/obsidian/`.
- Track Changes: 2.3.0, installed only in the synthetic vault.
- Vault/profile: synthetic notes and isolated `HOME`, `XDG_CONFIG_HOME`, and Electron user-data directories under ignored `test_vault/`.
- Provider: CORS loopback OpenAI-compatible SSE mock at `http://127.0.0.1:8765/v1`, model `mock-model`, dummy SecretStorage credential. No real account/key, paid/external provider call, private note, or pre-existing vault/profile was used.
- The mock recorded request bodies but never authorization headers. All captured evidence and screenshots remain ignored under `test_vault/evidence/`.

The plugin was built with `npm run build` and copied with:

```bash
mkdir -p test_vault/vault/.obsidian/plugins/emend
cp main.js manifest.json styles.css test_vault/vault/.obsidian/plugins/emend/
```

Obsidian's own `vault-open` IPC opened synthetic vaults, and Emend and Track Changes were enabled through the real trust control. CDP drove actual controls, request/write instrumentation, screenshots, and Obsidian APIs for navigation/setup.

## Chat, payload, and guarded-write evidence

`test_vault/evidence/verification.json` records the original non-modal matrix; its modal entries were superseded by the final Xvfb modal evidence below. Sanitized bodies from that original matrix are in `test_vault/evidence/requests.json`. The matrix used:

```bash
node test_vault/mock-provider.mjs
HOME="$PWD/test_vault/home" XDG_CONFIG_HOME="$PWD/test_vault/home/.config" \
  test_vault/obsidian/squashfs-root/AppRun --no-sandbox --disable-gpu \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir="$PWD/test_vault/home/electron"
node test_vault/verify.mjs
VERIFY_RESUME=1 node test_vault/verify.mjs
VERIFY_RESUME=1 VERIFY_RESUME_TRACK=1 node test_vault/verify.mjs
VERIFY_RESUME=1 VERIFY_RESUME_TRACK=1 VERIFY_RESUME_SELECTION_INVALID=1 \
  node test_vault/verify.mjs
```

Fourteen loopback requests were captured in this matrix:

| Request(s) | Scenario and actual assertion |
| --- | --- |
| 1–3 | Real Ask, Discuss, and Brainstorm submissions each contained the exact small rich-Markdown snapshot and bounded large snapshot with generic labels. Active and additional notes remained byte-for-byte unchanged. |
| 4 | **Include note path** on produced `Active note path: vault/Target A.md`, `Path: vault/Reference Small.md`, and `Path: vault/Reference Large.md`; path-off requests contained none of those labels or additional-note paths. |
| 5 | A selected note renamed before submission updated its visible path and supplied `RENAME_CONTENT_SENTINEL`. |
| 6 | A store-injected missing-path race produced `Additional note not found: Missing Race.md. Remove it and retry.` with zero new provider requests; the real Remove control cleared it and this explicit retry succeeded. |
| 7 | Target B sent only its own active content and `Reference B.md`; Target A content/selections and a second additional-note section were absent. Rapid A/B/A/B/A switching preserved independent selections/conversations and sent no request. |
| 8–10 | The held Ask request disabled composer and additional-note controls; Stop aborted it. Request 9 returned the synthetic HTTP 500, controls released, and request 10 succeeded. |
| 11 | Full-note Edit included both additional-note snapshots, but a `LARGE_ONLY_ANCHOR` replacement failed with `Operation 1 anchor or target was not found in the original snapshot.` and zero writes. |
| 12 | A valid active-target replacement caused exactly one `vault.modify('Target A.md', ...)` and produced `{~~ACTIVE_ORIGINAL~>ACTIVE_EDITED~~}`. Track Changes `tc-review-panel` showed one replacement. |
| 13 | The exact plugin selection coordinator included both additional-note snapshots, but `SMALL_ONLY_ANCHOR` failed validation with zero selection replacements. |
| 14 | A valid selection replacement caused exactly one `editor.replaceRange` and produced `{~~Selection original~>Selection edited~~}`. Track Changes showed both the earlier full-note and new selection replacements. |

For requests 1–3, the 1,000-character additional-note source budget was exactly `232 + 768 = 1000`: the complete 232-character small note, including frontmatter, wikilink, fenced code, and math, followed by 768 characters of the 1,965-character large note and `[...]`. `LARGE_TAIL_MUST_BE_OMITTED` was absent. Labels/fences/markers were not counted as source characters.

After request 14, native `editor.undo()` restored the exact pre-selection Markdown while retaining the earlier full-note suggestion. Both additional notes remained byte-for-byte unchanged throughout editing.

Deletion through the real Vault API removed the included path without a provider request. Actual `app:reload` then cleared both targets' in-memory selections, restored two ready conversations, displayed **No additional notes selected.**, and sent no request. Plugin data contained neither the dummy credential nor selected paths; persisted chats contained ready messages but no additional-note selections/snapshots.

## Real picker and Modify Selection modal evidence

The locked desktop and a bounded headless attempt initially prevented every modal, including Obsidian's Command Palette. No runtime defect was inferred from those environment failures. A user-local Xvfb package was then downloaded and extracted only under ignored `test_vault/xvfb/`; passwordless sudo was unavailable and no system files were changed:

```bash
mkdir -p test_vault/xvfb
cd test_vault/xvfb
apt-get download xvfb
dpkg-deb -x ./xvfb_*.deb root
```

The final isolated display, app, mock, and verifier used:

```bash
test_vault/xvfb/root/usr/bin/Xvfb :99 -screen 0 1280x900x24 -nolisten tcp
node test_vault/headless/mock-provider.mjs
DISPLAY=:99 HOME="$PWD/test_vault/headless/home" \
XDG_CONFIG_HOME="$PWD/test_vault/headless/home/.config" \
  test_vault/obsidian/squashfs-root/AppRun --no-sandbox --disable-gpu \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224 \
  --user-data-dir="$PWD/test_vault/headless/home/electron"
node test_vault/verify-modals-xvfb.mjs
```

`test_vault/evidence/xvfb-modals.json` is the final modal evidence. A fresh mock captured three final requests, and all five assertions passed:

1. The real chat **Add notes** picker selected `Reference Small.md` and `Reference Large.md`. Reopening it offered only `Reference B.md`, proving active-note and already-selected filtering without a request or write.
2. The real Modify Selection modal inherited both selections; its actual Remove, Clear all, and picker controls removed, cleared, and restored both paths without a request.
3. A held selection request disabled the input and every additional-note control. The real Cancel/Stop control aborted it and restored the controls while leaving the modal open.
4. A synthetic HTTP 500 left the modal open with retryable controls and no replacement.
5. One valid submission sent both additional-note sections exactly once with generic path-off labels and produced `{~~Selection original~>Selection edited~~}` only in the captured target. Both additional notes retained their original sentinels.

Earlier helper iterations exposed verifier issues—scope detection for a picker nested above the selection modal, request timing, and one incorrect fixture sentinel—not runtime failures. The final clean run reset the synthetic target and mock evidence and passed without assertion corrections.

## Final review fix-wave evidence

The final whole-branch fix wave added `test_vault/evidence/xvfb-rename.json` using the same isolated Xvfb/Obsidian setup and a separate loopback mock. All six targeted assertions passed: an already-open picker added to the renamed target; typed Modify Selection and all three quick actions sent the renamed target's two selected snapshots; and closing the selection modal closed its active picker. The focused RED run failed eight new regressions before implementation, the focused GREEN run passed 32/32 tests, and the final full gate passed 546/546 tests with clean lint, build, and diff check.

## Screenshots inspected

- `test_vault/evidence/selected-notes.png`: visible small/large paths and Remove controls.
- `test_vault/evidence/track-changes-full.png`: `ACTIVE_ORIGINAL` to `ACTIVE_EDITED` in the editor and real review panel.
- `test_vault/evidence/track-changes-selection.png`: both active-target suggestions in the real review panel.
- `test_vault/evidence/reload-restored.png`: restored ready chat and empty additional-note selections after actual reload.
- `test_vault/evidence/xvfb-picker.png`: real picker offering only the unselected `Reference B.md` after small/large selection.
- `test_vault/evidence/xvfb-selection-modal.png`: real Modify Selection modal and context disclosure.
- `test_vault/evidence/xvfb-selection-result.png`: synthetic provider-error notice followed by the successful one-change confirmation.

## Remaining limitations and non-goals

- Keyboard Ctrl+Z was not sent; native Obsidian undo was verified through the real `editor.undo()` API instead.
- No compression interaction was claimed or checked; automatic context compression and context accounting remain deferred in roadmap order after vision.
- Earlier `npm ci` runs reported 22 moderate severity dependency advisories; the final clean gate reported 13 as advisory data changed. No dependency or audit-fix change was made.

## Clean local gate

Run from the repository root:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: locked install succeeded; **28 Vitest files and 538 tests passed**; ESLint reported no findings; strict TypeScript and production esbuild succeeded; `git diff --check` reported no whitespace errors.

The isolated Obsidian, mock, and Xvfb processes were stopped after verification. No external review, push, issue, PR, merge, publish, version bump, or release-metadata change was performed.
