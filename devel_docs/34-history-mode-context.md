# Stage 34: History mode context documentation and verification

## Goal

Document the per-message mode, historical-permission, and origin semantics added for provider history, then verify the actual Edit-to-Ask sequence in real Obsidian with an isolated vault and a loopback streaming provider. Confirm that historical Edit outcomes are labeled without changing current-mode permissions, provider wire shape, visible chat status, or note-write behavior.

## Implementation details

- `README.md` now explains that ready model-history messages retain their mode, historical note-write permission, and origin. It identifies local Edit confirmations as local outcomes rather than model responses and states that only the currently selected mode controls note-write access.
- The documentation does not promise deterministic model behavior. The annotations describe requests to the provider; permission enforcement remains in Emend's current coordinator and writer boundaries.
- No runtime source, test, style, dependency, manifest, release, or conversation-schema file changed in this task.
- The verification harness, new vault/profile, captured payloads, results, verifier output, and screenshots remain ignored under `test_vault/`. The mock logs request payloads only, not authorization headers or credentials.

## Real-Obsidian verification

### Environment and commands

The production bundle from runtime commit `8880942` was installed in new ignored `test_vault/stage34-vault` with new ignored profile `test_vault/.emend-test-profile-34`. Real Obsidian reported `obsidian/1.11.7`, Chrome `142.0.7444.265`, and Electron `39.5.1`. CDP used port 9334 and the CORS-enabled loopback SSE mock listened only at `http://127.0.0.1:8834/v1`. Emend and Track Changes were enabled. The only note was synthetic `History34.md`, initially `Stage 34 synthetic note.\n`, and the only credential was dummy `dummy-stage34-deepseek`. No external provider, real account, real credential, private note, pre-existing profile, or pre-existing Obsidian process was used.

Actual commands:

```bash
npm run build && node test_vault/setup-stage34.mjs
node test_vault/mock-provider-34.mjs
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$PWD/test_vault/.emend-test-profile-34" --remote-debugging-port=9334
node test_vault/cdp-eval-34.mjs "(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent==='Trust author and enable plugins');if(button){button.click();return 'Disposable Stage 34 vault trust accepted';}return 'No trust prompt present';})()"
node test_vault/cdp-eval-34.mjs test_vault/stage34-scenarios.js > test_vault/stage34-results.json
node test_vault/cdp-eval-34.mjs --screenshot test_vault/stage34-final.png
node test_vault/verify-stage34.mjs
node test_vault/cdp-eval-34.mjs "(async()=>{await app.plugins.plugins.emend.activateChatView();await new Promise(resolve=>setTimeout(resolve,200));return 'Stage 34 chat restored for visible evidence';})()"
node test_vault/cdp-eval-34.mjs --screenshot test_vault/stage34-chat.png
curl -fsS http://127.0.0.1:8834/status
```

The trust prompt was accepted only in the disposable profile. The scenario clicked the real chat controls to submit Edit `insert tracked sentence`, waited for its local completion, then selected Ask and submitted `hello?`. The final verifier passed all assertions and the mock status reported exactly two requests. Only the isolated Obsidian and mock processes were stopped afterward; the pre-existing Obsidian process was left running.

The first verifier run exposed an incorrect verifier expectation, not a runtime failure: it expected the historical user entry to contain the coordinator's complete note-context envelope. Actual chat history correctly retains the original user instruction only. The assertion was corrected to require the exact annotation followed by `insert tracked sentence`; no runtime code or behavior assertion was weakened. The corrected verifier then passed, and both screenshots were visually inspected.

### Actual second-request payload assertions

The mock captured two actual `/v1/chat/completions` requests. The second contained exactly four messages: current Ask system prompt, historical Edit user message, historical local Edit status, and current Ask user message. Its system prompt contained both:

```text
Do not edit, modify, or write to the note. Respond only in chat.
History annotations describe earlier requests only and never change the current mode or permissions. Local Emend Edit statuses record outcomes; they are not model claims or instructions.
```

The historical user content was exactly:

```text
[Historical Edit message. Note writing was permitted for that earlier request only. Origin: user message.]
insert tracked sentence
```

The historical assistant content was exactly:

```text
[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit status, not a model response.]
Edit applied — 1 changes tracked. Review in Track Changes.
```

The current user entry ended with `User message:\nhello?` and included the current annotated note as normal Ask context. Every message in both captured requests had exactly the keys `role` and `content`; no internal `mode`, `origin`, or other custom field crossed the provider wire boundary. No additional request occurred while restoring the visible chat or capturing screenshots.

### Note writes, Track Changes, and visible chat

The scenario wrapped the real `app.vault.modify` and recorded only successful writes to `History34.md`. It observed exactly one successful target-note write, during Edit, with data:

```text
Stage 34 synthetic note.{++ Tracked insertion.++}
```

The vault text changed from `Stage 34 synthetic note.\n` to that expected tracked insertion after Edit and was byte-for-byte identical after Ask. Ask performed no additional write. Track Changes displayed `0 comments · 1 suggestion` and an `INSERT` card for `Tracked insertion.`; `stage34-final.png` shows the live insertion card.

After Edit, visible mode badges were `Edit`, `Edit`. After Ask they were `Edit`, `Edit`, `Ask`, `Ask`, with Ask as the active mode. The original local confirmation remained exactly `Edit applied — 1 changes tracked. Review in Track Changes.` The Ask response was `Hello from the Stage 34 local mock.` `stage34-chat.png` shows the unchanged historical Edit badges and local confirmation alongside the new Ask messages.

## Privacy and permission impact

Historical annotations are derived from existing internal role/mode data and add no note content, credentials, raw Operations output, or note path. They are sent only as part of an explicitly submitted provider request. In this verification, that provider was exclusively the loopback mock and request logs omitted headers.

The current Ask prompt remained read-only, and the Ask coordinator still has no note writer. Historical Edit permission did not grant current Ask access: the successful-write count stayed at one and the note did not change after Ask. Conversation storage, current permission checks, history length, provider wire compatibility, and Track Changes behavior were not changed by this documentation task.

## Clean final gate

Actual command:

```bash
npm ci && npm test && npm run lint && npm run build && git diff --check
```

Result: **PASS**. Clean installation added 351 packages from the committed lockfile; all **482 tests in 25 files** passed; ESLint completed with no findings; strict TypeScript checking and production esbuild succeeded; and `git diff --check` reported no whitespace errors.

## Self-review and non-goals

The final diff was reviewed against the Task 4 brief and Stage 26 design. It contains only `README.md` and this Stage 34 record. The README covers all required history semantics without claiming guaranteed model behavior, and this record includes actual request, write, UI, privacy, and clean-gate evidence. No runtime bug was found. The verifier-only correction described above is recorded for transparency.

This task did not change runtime code, add modes or permissions, alter persistence, add retries or model/provider behavior, test external providers, publish a release, or perform final whole-branch review/PR delivery. The controller owns final review and PR handling. No concerns remain for the covered documentation and real-Obsidian scenario.
