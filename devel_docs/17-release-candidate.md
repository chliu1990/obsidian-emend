# Stage 17: Final documentation, compatibility review, and release candidate

## Goal

Finalize current Emend documentation, verify the implemented architecture with a clean automated gate and complete real-Obsidian matrix, and prepare consistent 2.0.0 release-candidate metadata without publishing a release or changing the three deferred minor review items.

## Plan

1. Replace transition-era documentation and superseded implementation pseudocode with current behavior and links to the numbered stage records. Check runtime and current-document identifiers for removed architecture and providers.
2. Run `npm ci`, all tests, lint, strict production build, and `git diff --check` from the clean branch.
3. Exercise all modes, both edit strategies, full/selection editing, stale guards, Stop, long notes, structural preservation, instruction reload, persistence, quick actions, shortcuts, usage, smart context, and reload/unload cleanup in real Obsidian with Track Changes and a loopback mock.
4. Bump the breaking rewrite with `npm version major --no-git-tag-version`, verify all metadata, rerun the final gate, and record exact evidence.
5. Commit and push the release-candidate documentation/metadata, verify the dedicated Gitea runner, then record implementation and CI evidence in a documentation-only follow-up commit and verify that run. Do not publish a release.

## Implementation details

- `README.md` now describes the completed desktop rewrite, exact manual install path `<Vault>/.obsidian/plugins/emend/`, Track Changes prerequisite, current providers/modes/edit strategies, shortcuts, smart context, persistence, privacy, and token estimates.
- `AGENTS.md` treats the rewrite as implemented, describes `IMPLEMENTATION_PLAN.md` as the implemented-status architecture contract/stage index, and retains current source responsibilities, build/test commands, guarded runtime contracts, manual install path, and desktop-only declaration. Current release guidance targets the repository's Gitea host matching `origin`, with individual `main.js`, `manifest.json`, and `styles.css` assets and a tag exactly matching the manifest version without `v`; the stale GitHub-release instruction is removed.
- `IMPLEMENTATION_PLAN.md` is a concise architecture contract and index to all 17 numbered records rather than 757 lines of superseded pseudocode. `devel_docs/00-roadmap.md` links the final manual matrix.
- `devel_docs/manual-verification.md` records the complete actual matrix, environment, evidence counts, and unexercised platform limits.
- `npm version major --no-git-tag-version` produced 2.0.0 in `package.json`, `package-lock.json` root and package entries, `manifest.json`, and `versions.json`. The manifest description now names streamed chat and guarded Track Changes editing; `minAppVersion` remains 1.11.4 and `isDesktopOnly` remains true. No release was published.
- The deferred `vitest.config.ts` URL-path portability, post-`[DONE]` reader cancellation, and inherited operation-type validation items were not changed; none blocked verification.

## Verification results

- Compatibility Grep over `src`, `styles.css`, `manifest.json`, `README.md`, and `AGENTS.md` found no removed runtime provider/UI implementation. Matches were limited to intentional lineage/migration documentation, the documented absence of `requestUrl`/Gemini/Claude, and the existing narrow lint explanation for browser streaming. `OpenAI-compatible` remains intentional.
- Clean reproducibility and local gate: `npm ci` installed 351 packages from the committed lockfile; `npm test` passed 19 files and 396 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real verification used production Emend in ignored `test_vault/stage17_vault`, isolated profile `.emend-test-profile-17`, Obsidian 1.11.7 on macOS, CDP 9232, Track Changes 2.3.0, and loopback SSE mock 8797 with dummy credentials. Both isolated processes were stopped afterward. No real/paid provider call or other vault was used.
- `node test_vault/verify-stage17.mjs` passed 45 real provider requests, 29 exact Markdown/structural checks, nine freshly rebuilt Track Changes panels, and the original sanitized-thread checks. It covered all three provider configurations, all four modes, both strategies, full/selection edits, stale source/target/selection guards, Stop, long context, YAML/code/math, AGENTS/skill reload, persistence, all quick actions, macOS shortcuts, usage, smart/symmetric context, native undo, actual reload, and unload cleanup.
- Review expansion used the same real Obsidian/Track Changes/loopback environment with fresh fixtures and a separate request log. `node test_vault/verify-stage17-review.mjs` passed 40 actual requests, five byte- and card-equivalent operation pairs, six invalid/no-write cases, 16 new Track Changes panels, 27 core records, eight UI checks, and six storage checks. It added repeated anchors, malformed/unknown/ambiguous/overlapping/nested/out-of-selection operations, provider failures and no-partial-write retries, shared pending and independent notes, Stop/provider/validation/stale retries, rapid-switch guards, atomic replacement fallback, corrupt recovery, unsupported-version refusal, deletion retention, exact eight-message history, provider-option rejection without retry, transient-footer absence, actual Command Palette actions, and disabled/pending shortcut submission. Combined storage inspection covered 20 valid schema-1 threads plus retained corrupt/unsupported evidence and no temp files.
- Exact evidence, values, resulting Markdown summaries, UI behavior, and platform limits are in [Manual verification](manual-verification.md). Exact 1.11.4, Windows/Linux Ctrl UI, mobile, and physical non-macOS checks are not claimed.
- Metadata review confirmed package/manifest/lock version 2.0.0 and the `2.0.0: 1.11.4` compatibility mapping. No generated bundle, vault content, local profile, request log, credential, or other ignored file is included in git.
- Implementation commit `28dbf1d7af6b6de5da7074255f28b3157bf3143b`: Gitea run 73 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/73 and job 95 completed with conclusion **success** on `emend-macos-docker` from 10:50:05Z through 10:51:08Z. Checkout reached `HEAD is now at 28dbf1d`; `npm ci`, lint, all 396 tests in 19 files, and the 2.0.0 production build succeeded.
- Documentation-only evidence commit `ba11a338fc306bbbb3358ab61d33869daba9772a`: Gitea run 74 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/74 and job 96 completed with conclusion **success** on `emend-macos-docker` from 10:51:57Z through 10:53:14Z, repeating clean install, lint, all 396 tests, and the production build successfully.
- Review-expansion commit and final Gitea run: pending push; exact hash, run/job IDs, runner, and conclusion will be recorded after verification.
