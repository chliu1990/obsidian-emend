# Stage 39: Easier selected-text editing

## Status and scope

Issue #24 is implemented on `feature/easier-selection-editing`. The composer now has a two-value **Edit target** selector for typed Edit requests and the three existing quick actions. Automatic targeting displays **Selection** when the maintained target Markdown view has non-whitespace selected text and **Full note** otherwise. Actual target-note changes reset the choice to automatic; an explicit choice otherwise survives same-note renders and mode switches. The selector remains visible outside Edit because quick actions enter Edit and submit immediately.

Submission follows the maintained displayed target rather than recomputing automatic availability. Full note uses the existing full-note coordinator and guarded vault writer. Selection synchronously captures the exact `{ snapshot, editor }` and uses the existing selection coordinator and guarded native editor adapter. Empty, whitespace-only, or vanished Selection capture fails with `Select non-whitespace text first.` before messages, saves, provider calls, or writes; it never silently falls back to Full note.

## Selection request and result behavior

Composer Selection and the unchanged Command Palette modal use the same closed Operations protocol, complete untruncated selection, empty provider history, default smart structural context or Stage 09 symmetric opt-out, explicitly selected additional-note snapshots, structural validation, bounded replacement minimization, and one same-provider candidate-validation correction. Only the captured selection can be targeted. One native `editor.replaceRange` performs a changed selection edit, preserving Obsidian undo/redo and Track Changes as the only review surface.

Composer Selection reuses the normal chat lifecycle and stores only concise ready results such as `Edit applied — N changes tracked. Review in Track Changes.` or `No changes were needed.` Provider-reported or estimated usage covers every attempted round, and only successful-attempt reasoning survives correction. Raw candidates, correction feedback, rejected reasoning, note/selection snapshots, additional-note content, loading/error/stopped messages, and full annotated responses do not enter ready chat persistence.

The separate Modify Selection modal is intentionally unchanged in presentation: typed instructions and all three quick actions still use its existing pending controls and result/error notices without rendering a chat answer, token-usage footer, or retry-status display. The new composer result/usage behavior does not imply a new modal display.

## Clean local gates

The pre-verification clean gate ran from the repository root:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

The locked install succeeded; **36 Vitest files and 864 tests passed**; ESLint reported no findings; strict TypeScript and production esbuild succeeded; and `git diff --check` reported no whitespace errors. `npm ci` reported 13 moderate dependency audit findings; no dependency or unrelated remediation was part of this documentation task.

After the verification and documentation edits, `npm test && npm run lint && npm run build && git diff --check` again passed with **36 files and 864 tests**, no lint findings, a successful strict production build, and no whitespace errors.

## Real-Obsidian verification

- Date: 2026-11-07, Asia/Shanghai; Linux only.
- Implementation head: `b8b9f39ae78bcff8437dabc3aa4949ad82df6378`.
- Production bundle SHA-256: `b7386742a4aca49760a5dd044af2210c9dcfd5ef90c65cf39ec2821cbfbfda34`, identical to the copy loaded by the verification runtime.
- Runtime: official Obsidian 1.15.0 AppImage, Track Changes 2.3.0, isolated Xvfb `:101`, CDP port `19224`, and a synthetic vault/configuration under ignored `test_vault/emend-selection-chat-verify/runtime/`.
- Provider: CORS loopback OpenAI-compatible SSE mock at `127.0.0.1:18766`, fragmented content/reasoning events, controlled holds, per-round usage, and a dummy SecretStorage credential. No real account/key, external/paid call, private note, or pre-existing vault/profile was used.
- Final command: `node --check test_vault/emend-selection-chat-verify/mock-provider.mjs && node --check test_vault/emend-selection-chat-verify/verify.mjs && node test_vault/emend-selection-chat-verify/verify.mjs`.
- Final result: **13/13 scenarios and 239 assertions passed**, with zero production failures.

Evidence is under `test_vault/emend-selection-chat-verify/evidence/`:

- `summary.json` records implementation head, bundle identity, runtime, sanitized assertions, results, and limits;
- `logs/` contains sanitized actual provider request bodies without headers or credentials;
- `screenshots/` contains composer, modal, failure-state, and live 240px layout captures;
- `typed-native.json` records exact replaced/undone/redone editor values;
- `narrow-layout.json` records actual geometry and target options;
- `persisted-thread-audit.json` records actual schema 2 thread contents.

The final matrix covered:

1. **Automatic Selection and typed multiline edit:** selecting text and focusing chat displayed Selection. Enter submitted; Shift+Enter did not. The request contained the exact two-line selection, smart context, empty history, and no Web tools. One native replacement changed only `beta` to tracked `gamma`; outside Unicode remained exact. Chat showed concise content, provider usage, and reasoning. Native undo restored the complete original and redo restored the annotated selection.
2. **All three quick actions:** Fix grammar, Make concise, and Add examples remained available outside Edit, used their unchanged prompts, and each made one selection request and one native replacement with exact resulting bytes.
3. **Explicit Full note and Linux keyboard:** Full note survived a mode switch. Ctrl+Enter submitted the ordinary full-note request despite a live selection, changed an outside-selection anchor through exactly one guarded `vault.modify`, and made no native selection replacement.
4. **Fail-closed capture:** empty, whitespace-only, and vanished selections with Selection displayed each produced the existing Notice, zero requests, zero new chat messages/saves, zero selection/full-note writes, and unchanged bytes.
5. **Complete over-budget selection:** a 1,359-character selection exceeded the configured 1,000-character limit but appeared exactly in `Selected text`. The oversized containing block used `[...]` markers and added no out-of-budget surrounding source; one native replacement preserved the following source exactly.
6. **Additional notes and path privacy:** the real picker made no request or content read while opening/choosing. Submission read the reference once, included its content as read-only context, omitted its basename/path with path sharing off, left its bytes unchanged, and edited only the active selection.
7. **Invalid-to-valid correction:** two same-provider rounds preserved the original request and appended only the invalid candidate plus bounded typed feedback. Occurrence 2 alone changed through one native replacement. Ready/stored usage was `46 total · 33 prompt · 13 completion`; only successful reasoning survived, with no raw candidate or diagnostic leakage.
8. **Stop/retry:** Stop aborted a held selection request without an edit; a fresh submission used empty history and succeeded once.
9. **Stale source/retry:** an actual editor change before release triggered the exact stale-source error, preserved the user change, and prevented the model replacement. Restoring the synthetic source and resubmitting succeeded.
10. **Target-note switch:** switching during a held A request aborted it with zero A edits. Automatic targeting recomputed Selection for B, which completed independently; A remained byte-for-byte unchanged.
11. **Unchanged modal:** the existing editor command opened the same instruction/quick-action/additional-note modal without the new target selector or composer usage/reasoning displays. Its selection edit used one native replacement and created no composer message or chat thread.
12. **Narrow layout and keyboard evidence:** at an actual 240px right-sidebar width, the composer had no horizontal overflow and kept Edit target and Send visible with both options and the quick-action tooltip. Keyboard events were dispatched to the live composer through CDP.
13. **Persistence/privacy audit:** actual schema 2 files contained only ready messages and concise Edit results with successful usage/reasoning. Raw operations/candidates, correction diagnostics, rejected reasoning, selection snapshots/content, additional-note content, transient/error/stopped assistant states, and the dummy credential were absent. Fail-closed and modal workflows created no chat thread.

Reproduce with `node test_vault/emend-selection-chat-verify/verify.mjs`; it recreates the isolated runtime and evidence and stops its owned mock, Xvfb, and Obsidian processes.

## Verification limits and review boundary

Verification was Linux loopback only. Windows and macOS were not exercised. Enter, Ctrl+Enter, and Shift+Enter used trusted CDP-dispatched live-composer events, not physical OS-level typing; no Cmd platform mapping was exercised. No real-provider or paid smoke was run. These limits do not reduce the actual request, note-byte, native-editor, and persistence assertions above.

Task 4 changed current documentation and ignored synthetic verification artifacts only. Earlier verifier-only prompt-delimiter, escaping, and instrumentation mistakes were corrected before the final clean matrix; they were not production failures. Final independent whole-branch code and documentation reviews, CI, and PR creation remain controller steps rather than claims of this stage record.
