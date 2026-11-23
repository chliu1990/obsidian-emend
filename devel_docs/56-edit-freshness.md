# Stage 56: Shared edit freshness with native Selection writes

## Status, base, and scope

Implemented on `feature/2.11-pr03-edit-freshness` from merged main base `3a7f53edd3f889cfe6841f51af3e1918c3a7a8e3`. The production and test head for the unit and real-Obsidian evidence in this record is `0ddf2c5473f072fbe2f4ad85bf2466952462e7b8`.

This resolves [#77](https://github.com/chliu1990/obsidian-emend/issues/77): Full-note and Selection edits now use one fail-closed freshness decision without merging their writers. Full-note retains guarded `vault.modify`; Selection Edit and Modify Selection retain native `editor.replaceRange` on the captured range and native undo.

| Commit | Subject | Scope |
| --- | --- | --- |
| `78bfd45` | `refactor: add shared edit freshness guard` | Exact asynchronous disk/editor/target/abort contract and unit tests. |
| `b6262d1` | `refactor: use shared freshness for full-note edits` | Full-note adapter migration without changing its writer interface. |
| `585af74` | `fix: order full-note abort after permission check` | Review-driven final permission/abort/write ordering fix. |
| `0ddf2c5` | `fix: require fresh sources for selection edits` | Selection disk/every-editor readers, shared guard, production wiring, and native handoff. |

Explicit exclusions are [#76](https://github.com/chliu1990/obsidian-emend/issues/76) controller extraction, [#79](https://github.com/chliu1990/obsidian-emend/issues/79) scanner consolidation, [#91](https://github.com/chliu1990/obsidian-emend/issues/91) unexercised platform/provider coverage, target-flow redesign, Operations or CriticMarkup changes, new correction/retry behavior, a shared write executor, new writers, background work, persistence redesign, dynamic permission UI, cross-process locking, version metadata, workflows, releases, and generated/vault artifacts. Historical Stage 08/09/51/55 records were not changed.

## Chosen design and rejected alternatives

`src/edit-freshness.ts` owns one small asynchronous guard and no writer:

```ts
export const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

export interface EditFreshnessSource {
	readonly capturedText: string;
	readDiskText(): Promise<string>;
	readEditorTexts(): readonly string[] | undefined;
	isTargetCurrent(): boolean;
}

export async function assertEditFreshness(
	source: EditFreshnessSource,
	signal?: AbortSignal,
): Promise<void>;
```

The guard performs, in order:

1. immediate abort check;
2. exactly one awaited disk read;
3. one synchronous snapshot of supplied editor texts;
4. a second abort check;
5. exact full-document disk and every-editor comparisons plus the independent target-current check.

Every comparison is strict string equality against the complete captured note. There is no CRLF/LF, Unicode, whitespace, or other normalization and no content-based deduplication. `undefined` and `[]` editor lists impose no editor comparison, providing the existing disk-only comparison fallback; they never bypass `isTargetCurrent`. Selection always adds its captured editor explicitly before every supplied open editor.

Disk/editor/target mismatch throws only `STALE_NOTE_ERROR`. Abort and reader errors propagate unchanged. The guard performs no logging, retry, persistence, network call, source-text return, or write. Concise errors contain no divergent excerpt, candidate, source snapshot, or new path detail.

Two alternatives were rejected:

- **Synchronous comparator with duplicated asynchronous adapters:** smaller, but it would preserve drift in disk-read, editor-snapshot, and post-read abort ordering.
- **Shared writer executor with callbacks:** would couple permission/result behavior to writing, obscure Selection's synchronous native handoff, and risk becoming a third writer abstraction.

## Writer order and terminal behavior

Both writers retain initial Edit-permission and unchanged-result checks before freshness. Read-only modes and no-op results perform no freshness I/O or write. A changed candidate then follows:

```text
shared freshness
→ second Edit permission check
→ final abort check
→ writer invocation with no intervening await
```

Full-note awaits its single existing `writer.write`, adapted to guarded `vault.modify`. Selection computes and revalidates the composed complete document, awaits freshness against `snapshot.fullText`, then performs the second permission check, final abort check, and native captured-offset `replaceRange` synchronously. Selection never calls `vault.modify`; neither writer calls the other.

Candidate-validation failure retains one same-provider correction. A stale result after a valid correction is terminal: no third request and no write. Provider, abort, stale, capacity, permission, read, and write failures receive no candidate correction. Dynamic permission denial remains unit-matrix evidence because the runtime has no permission toggle to manipulate during a real request.

Closing every editor does not authorize a disk-only write: production independently requires the original active target. Wrong-target, closed captured Selection view, and no-open-target states fail closed without rerouting. CRLF disk text versus LF-normalized host editor text fails closed and preserves raw disk bytes. Exact matching-CRLF success is pinned in unit tests; this real host matrix does not claim a successful real CRLF edit.

The final check-then-write handoff is not a cross-process compare-and-swap. An external process can still write after the final check. This stage adds no lock, watcher, merge, post-write conflict detector, or atomic external-write guarantee.

## Genuine RED and unit evidence

Task 1 ran `npx vitest run tests/edit-freshness.test.ts` before the module existed: **1 file failed, no tests ran**, with the intended missing-module error. The implemented guard passed **16/16** tests, strict typecheck, and focused ESLint.

Task 2 added final-abort, matching-CRLF, and ordered-handoff cases before migrating Full-note. `npx vitest run tests/note-writer.test.ts` produced **1 failed / 20 passed**: the old implementation wrote after the target check triggered abort. After migration, the focused guard/writer/coordinator run passed **3 files / 113 tests**. The independent ordering review then exposed final-abort/second-permission inversion; the new ordering case failed **1 / 22** before the one-line fix and the focused run passed **3 files / 114 tests** afterward.

Task 3 added independent disk/captured/secondary doubles and production-wiring cases before changing Selection:

```text
npx vitest run tests/selection-editor.test.ts tests/main.test.ts
Test Files  2 failed (2)
Tests       18 failed | 104 passed (122)
```

The old Selection applied disk/secondary-divergent edits and lacked required readers and asynchronous behavior. After implementation, the original command passed **2 files / 122 tests**. The required affected regression command passed **12 files / 789 tests**, and strict typecheck passed.

The unit matrix covers:

| Boundary | Unit result |
| --- | --- |
| Disk-only fallback and all-editor match | `undefined`/`[]` and matching editors succeed without weakening target identity. |
| Disk, captured-editor, later-editor, and dirty-target/clean-sibling divergence | Exact stale error and zero writes; a clean sibling cannot mask a dirty target. |
| Selection change inside or outside the Selection | Complete `fullText` comparison rejects both; selected-text-only comparison is forbidden. |
| Unrelated-file editor divergence | Ignored; readers remain bound to the captured file. |
| Wrong, closed, or absent target | Stale; no rerouting or disk-only authorization. |
| Matching CRLF; CRLF/LF and NFC/NFD differences | Exact matching CRLF succeeds in mocks; normalization-only differences reject. |
| Immediate, pending-read, and target-check-triggered abort | No write; abort identity and read boundaries are preserved. |
| Reader/writer errors | Original error propagates without correction. |
| No-op/read-only modes | No freshness read or write; validated no-op summary behavior is retained. |
| Stale after correction and error privacy | No third request/write; no source sentinels in concise errors. |
| Writer routing | Full-note uses one vault write; Selection uses one exact native replacement. |

Task full suites passed **55 files / 1,910 tests** after Task 1, **55 / 1,913** after the initial Task 2 migration, and **55 / 1,924** after Task 3. Task 3's full lint and production build also passed. Task 4's required full suite again passed **55 files / 1,924 tests**.

The Task 2 real-Obsidian Selection baseline was **not genuine runtime RED**. Obsidian synchronized direct disk divergence into the captured editor before the old editor-only guard applied, so the old writer also rejected. The 18 unit failures above are the genuine Selection regression evidence; no real baseline write is claimed.

## Real-Obsidian runtime evidence

Task 4 built the exact code head and ran:

```bash
npm run build
node test_vault/emend-selection-chat-verify/verify.mjs --edit-freshness
node test_vault/emend-selection-chat-verify/verify.mjs --edit-target-flow
node test_vault/emend-selection-chat-verify/verify.mjs --stabilization
node test_vault/emend-selection-chat-verify/verify.mjs --sessions
```

Final results judged from scenario output and each `summary.json`:

| Group | Scenarios | Assertions |
| --- | ---: | ---: |
| `--edit-freshness` | 24 passed, 0 failed | 227 |
| `--edit-target-flow` | 5 passed, 0 failed | 95 |
| `--stabilization` | 6 passed, 0 failed | 55 |
| `--sessions` | 9 passed, 0 failed | 156 |
| **Total** | **44 passed, 0 failed** | **533** |

The inherited verifier computed but did not propagate its exit status. The ignored harness now assigns `process.exitCode`; its two harness-development runs returned real nonzero statuses for failed assertions/setup. Those failures were not product RED: two required a fixed disk-only editor shape despite host synchronization, and one requested a new tab after detaching the last tab group. The harness was corrected to record host timing and to open a replacement same-note tab before closing the captured view. A later self-review also strengthened instrumentation to wrap every opened Markdown editor and count B-side vault calls. All four groups were rerun after that strengthening. Production source and committed tests did not change.

### Focused matrix

| Focused cases | Actual evidence |
| --- | --- |
| Full-note disk, captured editor, secondary popout, wrong target, no open target | Five scenarios rejected with the exact stale error, preserved user/original/unrelated bytes, made zero native/plugin writes on instrumented targets, and made no correction. |
| Selection disk, captured editor inside/outside, secondary popout, wrong target, closed captured view, no open target | Seven scenarios rejected with zero native/plugin writes. Closed-target retained a different open same-note editor while the captured view was detached; no-open had zero same-note editors. |
| Matching multi-pane Full-note and Selection | Full-note used exactly one plugin vault write and no native replacement. Selection used exactly one native replacement at captured offsets and no plugin vault write. Both open panes and disk held the exact expected document. |
| Selection native undo/redo | Actual editor undo restored the complete pre-edit document; redo restored the exact CriticMarkup document; outside-Selection text remained exact. |
| CRLF disk versus host editor | Both paths observed CRLF-only disk and LF-only editor text, rejected stale, made zero writes, and preserved every raw CRLF file byte. No real CRLF success is claimed. |
| Abort and Stop | Both paths stopped during an instrumented held post-response `vault.read`; releasing the read caused no late write. Immediate Stop before response release also caused no late write and preserved bytes. |
| No-op and writer-free controls | Full-note and Selection no-op returned before freshness disk I/O. Ordinary Chat and Chat Selection completed with zero writes and unchanged bytes. |
| Stale after valid correction | Both paths made exactly two requests (invalid candidate plus valid correction), then rejected stale with no third request/write. |
| Error and persistence privacy | Every focused stale message equalled the concise stale error without sentinels. Twenty-one focused saved-chat files contained only ready messages and no raw candidates, rejected artifacts, source snapshots, divergent sentinels, or dummy credential. |

### Host synchronization and pane observations

- In the final focused Full-note direct-disk run, `hostSynchronizedBeforeSample: true`: the editor already contained the synthetic disk change at the release sample. The final Selection run instead preserved `preservedDiskOnlyShape: true`, with divergent disk and captured-source editor text at release; its editor contained the user disk text afterward. Both rejected without writes and preserved user disk bytes. Task 3 and earlier Task 4 attempts observed yet other timing, so neither synchronization shape is treated as invariant. The pure guard and adapter unit matrices independently pin disk-only behavior without host scheduling.
- The focused secondary scenarios used real same-file popout editors. Both retained an actually independent clean target and divergent sibling at release (`independentSecondaryDivergence: true`, `mirroredIntoTarget: false`) and rejected. This is real popout evidence, not a unit-only claim.
- The final inherited stabilization multi-pane run observed `siblingMirroredTarget: false` and `siblingHeldCaptureAtApply: true`, directly exercising a dirty target with a clean sibling while disk still matched the capture. Earlier Task 4 development evidence observed mirroring instead. Host timing can therefore produce either mirrored or independent text; no universal pane-independence or mirroring claim is made. Unexercised same-window and dirty-target/clean-sibling timing variants remain unit-level.

Writer logs captured actual `vault.modify` and native `replaceRange` calls, including both captured and wrong-target notes. Note bytes were read directly from the synthetic vault. Saved-chat and request-log audits found no authorization headers, HTTP header objects, or dummy credential. Screenshots, logs, summaries, mock responses, and runtime vault content remain under ignored `test_vault/emend-selection-chat-verify/` paths. Final preserved summaries are under `evidence-task4-pr03/{edit-freshness,edit-target-flow,stabilization,sessions}/summary.json`.

## Bundle identity and environment limits

Every final summary recorded:

```text
head: 0ddf2c5473f072fbe2f4ad85bf2466952462e7b8
root main.js SHA-256:   6a9243e563816c4c7be57177344c02c8a86a2902e8f87882c964448c63942d5a
loaded main.js SHA-256: 6a9243e563816c4c7be57177344c02c8a86a2902e8f87882c964448c63942d5a
loadedBundleMatchedRoot: true
```

Setup independently hashed root and loaded bundles before launch, and the summary hashed both again. The production build and strict typecheck passed before these runs.

For Task 4's documentation gate, `npm test` passed **55 files / 1,924 tests**. `package.json` exposes no repository link/anchor audit script, so a local one-off audit resolved **161 relative links and 9 anchors across the seven changed/new documents**; manual inspection covered the newly added Stage 56 references. `git diff --check` passed. These are Task 4 results, not the final Task 5 exact-head gate.

Environment actually exercised: Linux `x86_64`, kernel `6.12.117+deb13-amd64`; official Obsidian **1.15.0** AppImage; isolated Xvfb `:101`; CDP `19224`; default dark theme as shown in preserved screenshots. Actions used real DOM/workspace calls and CDP-dispatched events, not physical OS-level input.

Provider evidence is loopback OpenAI-compatible SSE/CORS at `127.0.0.1:18766`, deterministic synthetic Operations/responses, and a dummy SecretStorage credential. No real account, real credential, external network, paid call, or real-provider behavior was used. No Windows, macOS, mobile, screen-reader, physical-input, third-party-theme, other-Obsidian-version, or unexercised popout/window-manager coverage is claimed. Unit tests use Obsidian mocks and do not establish host bytes, synchronization, or native undo.

Tasks 1–3 received their assigned independent reviews, including the Task 2 ordering fix. Task 4 is documentation/evidence only and did not dispatch another reviewer. Final exact-documentation-head gates, the fresh whole-PR write/security review, and submission evidence belong to Task 5 and the SDD ledger/PR; they are not claimed here. The documentation commit changes embedded build identity, so this record intentionally preserves code-head runtime evidence rather than inventing final-head results.
