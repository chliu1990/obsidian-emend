# Stage 53: Emend 2.10.0 release

## Scope

This stage is release-only. It changes no runtime source, style, workflow, dependency, or command ID; the only test edit is the version pin below.

| Kind | Change |
| --- | --- |
| Changelog | A `2.10.0` section covering the composer, Selection, Related notes, Web, stabilization, and documentation work since 2.9.0, plus updated comparison links. |
| Version metadata | `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` synchronized to `2.10.0` through `npm version minor`. |
| Release-only documentation | Pre-release status notes removed from `README.md` and `INSTALLATION.md`; `ROADMAP.md` and [publication](publication.md) status updated. |
| Test pin | `tests/settings.test.ts` now pins `2.10.0`, following the same release-time update as earlier versions. |

The release keeps plugin ID `emend`, `minAppVersion` `1.11.4`, and `isDesktopOnly: true`.
Obsidian desktop 1.11.4 or newer remains the only declared platform.

## Local gate

Run from the repository root on the release branch:

```bash
npm ci
npm test
npm run lint
EMEND_RELEASE_BUILD=1 npm run build
git diff --check
```

- `npm ci` installed from the committed lockfile. `npm audit` reported 13 moderate advisories and no other severity; this release adds, removes, and upgrades no dependency.
- `npm test` passed **53 files / 1,877 tests**.
- `npm run lint` completed with no findings.
- The release build passed strict TypeScript checking and produced a minified `main.js` with SHA-256 `7066d4356c9d4497986bde8df6e7ece6f7b46d95852bbfd09b897667e63701b9` and build identity `2.10.0`.
- `git diff --check` reported no whitespace errors.

## Packaged-install verification

The release ZIP was packaged exactly as `.github/workflows/release.yaml` does it: `main.js`, `manifest.json`, and `styles.css` copied into `package/emend/` and zipped as `emend-2.10.0.zip`.
Its SHA-256 was `a5cabd52b7a08e986e4f1838c2bb680cd1523488f0f98f5e5d5d6b4f15c5e378`.

The harness is ignored `test_vault/emend-2.10.0-release-smoke/verify-runtime.mjs`.
It extracts the ZIP into a fresh vault's `.obsidian/plugins/`, starts official Obsidian under isolated Xvfb `:103` with CDP on 19227, and records evidence in `evidence/summary.json` and `evidence/emend-2.10.0-release-smoke.png`.

- Environment: Linux, Obsidian **1.15.0** from the AppImage package metadata, a fresh vault containing one synthetic note, a loopback SSE mock at `http://127.0.0.1:8791/v1`, and one dummy SecretStorage credential. No real account, paid call, private note, or other vault was used.
- Install integrity: the installed `main.js`, `manifest.json`, and `styles.css` were byte-identical to the packaged assets, with the hashes above.
- Load identity: the runtime manifest reported `emend` / `Emend` / `2.10.0` / `1.11.4`, the enabled set contained `emend`, and a clean install had no provider credentials.
- Composer: build identity read `2.10.0`, the Writing/Web trigger summarized `Chat`, the model control read `DeepSeek · deepseek-flash · High`, Send was present, and opening chat created no message.
- Settings: saving the loopback base URL stored an empty `apiKey` field and a SecretStorage credential.
- Chat round trip: the streamed answer rendered as ready Markdown with `Provider usage · 132 total · 120 prompt · 12 completion`, and the note stayed byte-for-byte `Alpha beta gamma.\n`.
- Full-note Edit: the `Edit · Full note` menu choice changed the note to `Alpha {~~beta~>BETA~~} gamma.\n` once, and chat showed the header, `Target: Full note.`, the optional summary, and `Replaced line 1.`
- Requests: exactly two reached the mock, both `stream: true` for `deepseek-flash` with `stream_options.include_usage`; the Edit system prompt contained the Operations array instruction.
- Result: **24 assertions passed**.
- Limits: this smoke covers Linux/Xvfb, one loopback provider, Chat, and one full-note Edit only. Track Changes rendering, Selection editing, Web retrieval, macOS, Windows, mobile, physical input, screen readers, and real providers are covered by the stage records or not exercised here.

## Published release

The tag, workflow run, and downloaded release assets are verified after tagging and recorded in a follow-up commit to this record.
Launch copy and the remaining checklist live in [publication](publication.md).
