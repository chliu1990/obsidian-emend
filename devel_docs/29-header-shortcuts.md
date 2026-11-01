# Stage 29: header shortcuts and build identity documentation and verification

## Goal

Document and verify the completed chat-header default shortcuts and build identity in real Obsidian. Use only synthetic notes and a new isolated ignored vault/profile, make no provider request, and leave runtime code, release metadata, and generated bundles outside the documentation commit.

Tracking issue: https://github.com/chliu1990/obsidian-emend/issues/14

## Implementation details

- The title row contains the existing **Emend** title and a compact muted build identity. Two column-stacked, wrapping muted groups below it list the four default shortcut labels before the active-note context.
- macOS displays `⌘⇧A Ask`, `⌘⇧E Edit`, `Enter / ⌘ Enter send`, and `Shift Enter newline`. Windows/Linux displays `Ctrl+Shift+A Ask`, `Ctrl+Shift+E Edit`, `Enter / Ctrl+Enter send`, and `Shift+Enter newline`. These are static descriptions of Emend's defaults, not dynamically remapped Obsidian hotkeys. **Open Emend chat** has no advertised default hotkey.
- esbuild injects `__EMEND_BUILD_ID__`. `EMEND_RELEASE_BUILD=1` selects the complete `manifest.json` version; every other build executes `git rev-parse --short HEAD` at build time and rejects an empty identity. No runtime Git, filesystem, Node, network, or repository metadata path is added to the plugin.
- Development watch captures the short hash when its esbuild context starts. Restart `npm run dev` after a commit to advance the label; dirty files alone do not change it. Ordinary production and untagged CI builds also use the short hash, while the release workflow opts into the validated manifest version.
- `README.md` now documents the exact platform labels, default-versus-remapped boundary, build identity meanings, and development-watch restart requirement.
- This documentation/verification task changed no `src/`, `tests/`, `styles.css`, dependency, workflow, manifest, or release-metadata file. Production bundles were copied only into the ignored isolated vault.

## Build-mode evidence

Verification was run at runtime HEAD `894a731` with manifest version `2.1.0`. The following commands were executed from the repository root:

```bash
npm run dev
node test_vault/check-stage29-build.mjs development "$(git rev-parse --short HEAD)"
npm run build
node test_vault/check-stage29-build.mjs untagged-production "$(git rev-parse --short HEAD)"
EMEND_RELEASE_BUILD=1 npm run build
node test_vault/check-stage29-build.mjs release "$(node -p "JSON.parse(require('node:fs').readFileSync('manifest.json','utf8')).version")"
```

The development watcher was stopped after its successful initial build so the production forms could be checked independently.

| Build form | Expected and observed identity | Bundle bytes | Inline source map | Result |
| --- | --- | ---: | --- | --- |
| Development/watch | `894a731` | 342,757 | Yes | PASS |
| Untagged production | `894a731` | 53,563 | No | PASS |
| Release mode | `2.1.0` | 53,561 | No | PASS |

Each assertion read the actual root `main.js`, required the JSON-encoded expected identity to be present, and checked the expected development/production source-map form.

## Real-Obsidian verification

Environment: real Obsidian on macOS reporting `obsidian/1.11.7`, Chrome `142.0.7444.265`, Electron `39.5.1`; CDP 9339; new ignored vault `test_vault/stage29_vault`; and new ignored profile `test_vault/.emend-test-profile-29`. Only Emend was enabled. The active custom provider pointed to loopback port 9 with an empty API key and model label `stage29-no-request`; no prompt was submitted and no provider request was made. The two notes were synthetic, and both remained byte-for-byte unchanged. No real credential, external provider, private note, or user profile was accessed.

The untagged production bundle was installed first and inspected. The release-mode bundle was then built, copied over that isolated installation, and loaded through an actual renderer reload. Obsidian's expected first-open trust prompt was accepted only in the disposable profile.

Actual fixture and CDP commands:

```bash
node test_vault/setup-stage29.mjs
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$PWD/test_vault/.emend-test-profile-29" --remote-debugging-port=9339
node test_vault/cdp-stage29.mjs "(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent==='Trust author and enable plugins');if(!button)throw new Error('Trust button absent');button.click();return 'Disposable Stage 29 vault trust accepted';})()"
node test_vault/cdp-stage29.mjs "globalThis.stage29ExpectedIdentity='894a731';globalThis.stage29BuildForm='untagged-production';'Stage 29 production identity set'"
node test_vault/cdp-stage29.mjs test_vault/stage29-check.js > test_vault/stage29-production.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-production-normal.png
node test_vault/cdp-stage29.mjs test_vault/stage29-narrow.js > test_vault/stage29-production-narrow.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-production-narrow.png
cp main.js manifest.json styles.css test_vault/stage29_vault/.obsidian/plugins/emend/
node test_vault/cdp-stage29.mjs "location.reload();'Stage 29 release bundle reload requested'" > test_vault/stage29-release-reload.json
node test_vault/cdp-stage29.mjs "(async()=>{for(let i=0;i<200&&!globalThis.app?.plugins?.plugins?.emend;i++)await new Promise(r=>setTimeout(r,50));if(!globalThis.app?.plugins?.plugins?.emend)throw new Error('Release Emend did not load');globalThis.stage29ExpectedIdentity='2.1.0';globalThis.stage29BuildForm='release';return 'Stage 29 release identity set';})()"
node test_vault/cdp-stage29.mjs test_vault/stage29-check.js > test_vault/stage29-release.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-release-normal.png
node test_vault/cdp-stage29.mjs test_vault/stage29-narrow.js > test_vault/stage29-release-narrow.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-release-narrow.png
node test_vault/verify-stage29.mjs
```

Result: **PASS** for both installed forms and all sanitized assertions.

1. **Live title identity — PASS.** The actual header DOM showed `Emend` with `894a731` for untagged production and `2.1.0` after the release-mode reload.
2. **Exact macOS labels — PASS.** Both forms displayed `Default shortcuts` followed by exactly `⌘⇧A Ask`, `⌘⇧E Edit`, `Enter / ⌘ Enter send`, and `Shift Enter newline`, with no Open-chat hotkey label. Non-mac label sets remain covered by the platform-helper unit tests rather than this macOS manual run.
3. **Normal and narrow layout — PASS.** Obsidian's actual right-split `setSize` produced chat widths of 420 px and 220 px. Shortcut items occupied two rows (35.1875 px high) at normal width and three rows (54.78125 px high) at narrow width. Computed styles were `display: flex` and `flex-wrap: wrap` with 12 px build/shortcut text.
4. **Long-note ellipsis and overflow — PASS.** The synthetic context label retained its complete DOM text. Its scroll width was 696 px versus client widths of 396 px and 196 px at the two sizes; computed styles were `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`. The chat view, header, title row, and shortcut row each had `scrollWidth <= clientWidth + 1`, with no horizontal overflow at either width.
5. **Readable muted text — PASS.** The tested dark theme computed build and shortcut color to `rgb(179, 179, 179)`. Calculated contrast against the effective rendered background was 7.2178:1 at both widths and for both bundles.
6. **Stable rerenders — PASS.** Edit-mode, Ask-mode, second-note, restored-long-note, request-pending, and request-settled renders all retained the same title, identity, heading, and four labels. The request-state checks set the loaded view's sending state and invoked its render path without submitting a request; pending showed **Stop** with a disabled composer, and settled restored **Send** with an enabled composer. No note request remained pending.
7. **Screenshots — PASS.** `stage29-production-normal.png`, `stage29-production-narrow.png`, `stage29-release-normal.png`, and `stage29-release-narrow.png` were captured through CDP and visually inspected. They show the expected identities, wrapped labels, and ellipsized synthetic long-note context.

Only the isolated Obsidian process was stopped afterward. The pre-existing Obsidian process (PID 46262) remained running. All helpers, profiles, vault content, dummy configuration, JSON results, and screenshots remain ignored under `test_vault/` and are not part of the documentation commit.

## Clean final gate

Actual command:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: **PASS**. `npm ci` installed 351 packages from the committed lockfile. Vitest passed **24 files and 463 tests**. ESLint completed with no findings, strict TypeScript checking and production esbuild succeeded, and `git diff --check` reported no whitespace errors.

## Accessibility, layout, privacy, and non-goals

- The new identity and shortcut text are noninteractive header content; no new focus stop, keybinding, command, provider behavior, note access, or request path is introduced. Existing mode and composer controls are unchanged.
- Small muted text uses Obsidian variables and had 7.2178:1 contrast in the tested theme. Flexible wrapping avoids a fixed header width, while the existing single-line note-label ellipsis prevents long names from widening the sidebar.
- Verification used no credentials or network provider calls and did not alter either fixture note. Sanitized evidence contains only synthetic note names/content and local layout metadata.
- Dynamic Obsidian hotkey-manager/remapping integration, new or changed shortcuts, an Open-chat default hotkey, sidebar-tab title changes, settings, provider changes, release-version changes, and unrelated visual redesign remain non-goals. Windows/Linux labels were not manually exercised on this macOS host; their exact pure-helper output is unit-tested.

## Shortcut badge refinement

The header now uses two column-stacked wrapping groups beneath the title. The first contains **Default shortcuts**, `⌘⇧A` / **Ask**, and `⌘⇧E` / **Edit**; the second contains `Enter / ⌘ Enter` / **send** and `Shift Enter` / **newline**. Every key is a semantic `<kbd>` badge and every action is a separate unbadged span. Badge border, background, and normal text color use existing Obsidian theme variables; padding, radius, and line height use small fixed values, and the font is inherited. The note context remains immediately after the groups. No label, keybinding, command, request, or note-writing behavior changed.

CSS regressions require the column container, wrapping flex groups, inline-flex key/action pairing, and the badge border/background/text declarations. The focused red run failed four assertions because those selectors and the column declaration were absent. After implementation, the focused 52 tests and complete 466-test suite passed, along with ESLint, strict TypeScript/production build, and `git diff --check`.

### Real-Obsidian badge verification

The untagged production build at `d19b2cf` was installed into the same ignored `test_vault/stage29_vault` and loaded in a newly started isolated instance using `test_vault/.emend-test-profile-29` and CDP 9339. The environment again reported Obsidian `1.11.7`, Chrome `142.0.7444.265`, and Electron `39.5.1`. Only the two existing synthetic notes were opened. No prompt or provider request was submitted, both notes remained byte-for-byte unchanged, and no real credential, provider, private note, or user profile was accessed.

Actual CDP scenario and assertion commands after installing the bundle and starting the isolated instance:

```bash
node test_vault/cdp-stage29.mjs "globalThis.stage29ExpectedIdentity='d19b2cf';globalThis.stage29BadgeWidth=420;'Stage 29 badge verification configured'"
node test_vault/cdp-stage29.mjs test_vault/stage29-badges.js > test_vault/stage29-badges-normal.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-badges-normal.png
node test_vault/cdp-stage29.mjs "globalThis.stage29BadgeWidth=220;'Stage 29 narrow badge width set'"
node test_vault/cdp-stage29.mjs test_vault/stage29-badges.js > test_vault/stage29-badges-narrow.json
node test_vault/cdp-stage29.mjs --screenshot test_vault/stage29-badges-narrow.png
node test_vault/verify-stage29-badges.mjs
```

Result: **PASS** at both actual chat widths.

1. **Semantic DOM and exact text — PASS.** There were exactly two groups with two shortcut items each. Four direct `<kbd>` children appeared in order as `⌘⇧A`, `⌘⇧E`, `Enter / ⌘ Enter`, and `Shift Enter`; their separate direct action spans were exactly `Ask`, `Edit`, `send`, and `newline`. Each item had exactly `KBD` and `SPAN` children. Action spans had transparent backgrounds and zero-width borders.
2. **Computed badge styling — PASS.** At both widths every badge had a 1 px solid `rgb(51, 51, 51)` border, `rgb(40, 40, 40)` background, and `rgb(218, 218, 218)` text, matching probes resolved from `--background-modifier-border`, `--background-secondary`, and `--text-normal`. Muted action text remained `rgb(179, 179, 179)`. The container computed to `flex-direction: column`; both groups computed to `display: flex` and `flex-wrap: wrap`.
3. **Normal and narrow wrapping — PASS.** At 420 px the two groups each occupied one flex line and the shortcut container was 40.59375 px high. At 220 px each group occupied two flex lines and the container was 86.1875 px high. The view, header, title row, shortcut container, both groups, and all four items satisfied `scrollWidth <= clientWidth + 1`; the view/client widths were exactly 420/420 px and 220/220 px.
4. **Unchanged identity and context — PASS.** Both layouts retained title `Emend`, identity `d19b2cf`, the complete synthetic long-note DOM label immediately after the groups, and context ellipsis. No note request was pending.
5. **Screenshots — PASS.** `stage29-badges-normal.png` and `stage29-badges-narrow.png` were captured through CDP and visually inspected at full header resolution. They show distinct bordered key badges, separate muted actions, two groups, internal narrow wrapping, and no horizontal overflow.

Only the newly started isolated Obsidian instance was stopped afterward. Pre-existing Obsidian PID 46262 remained running. The CDP helpers, JSON results, verification summary, and screenshots remain ignored under `test_vault/` and are not part of the documentation commit.
