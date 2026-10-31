# Stage 12: Add explicit quick actions

## Goal

Add Fix grammar, Make concise, and Add examples actions that authorize one explicit guarded Edit request each. Every action must use the normal chat submission path, show its prompt and Edit badge, retain normal history and persistence, and remain unavailable without a loaded note or while work is pending.

## Plan

1. Add test-first coverage for the exact stable action IDs, labels, deterministic nonempty prompts, forced Edit mode, one normal submission per click, visible/persisted messages, and unavailable states.
2. Define the action catalog and shared availability predicate in a focused module. Render buttons above the composer and delegate clicks to the existing prompt submission with the mapped prompt and Edit mode.
3. Reuse the existing context capture, per-note pending registry, provider request, CriticMarkup validation, stale/target/permission checks, concise edit history, and settlement rendering without adding another writer or request path.
4. Update usage and architecture documentation. Run focused red/green tests and the full local gate, then exercise every action from a non-Edit mode in real Obsidian with an isolated vault and delayed loopback SSE mock.
5. Self-review, commit and push the implementation, verify the dedicated Gitea runner, then record that evidence in a documentation-only commit and verify its run.

## Implementation details

- `src/quick-actions.ts` exports `QUICK_ACTIONS` with stable IDs `fix-grammar`, `make-concise`, and `add-examples`, the required labels, deterministic nonempty prompts, and `mode: 'edit'` for every entry. `areQuickActionsDisabled()` centralizes the no-note, thread-loading, and sending states.
- `src/chat-view.ts` renders the three buttons above the composer with `data-action-id` attributes. A click calls `submitQuickAction()`, which checks the same availability predicate, selects Edit, and awaits the existing `submitPrompt(action.prompt)` exactly once. The composer still uses the same method with its own text.
- The normal submission path therefore captures current context and history, creates the visible ready user message and Edit-badged loading message, acquires the plugin's per-note pending guard, performs the existing guarded Edit request, saves concise results, and rerenders on settlement. No quick-action code calls the provider or a note writer directly.
- All actions disable when no note thread is available, while a thread loads, and while sending. The existing render after success, error, stale failure, validation failure, or Stop re-enables them whenever a note is usable.
- `styles.css` adds only `emend-`-prefixed layout and button styles using Obsidian variables. No dependencies or public command/view identifiers changed.
- `tests/quick-actions.test.ts` adds 15 tests for the catalog, forced mode and single delegation from a non-Edit mode, normal request/history/persistence behavior, and all availability states. Existing guarded writer and request-isolation tests remain unchanged and green.

## Verification results

- Focused red: `npx vitest run tests/quick-actions.test.ts` failed because `src/quick-actions.ts` did not exist. After the minimal implementation, the combined run initially exposed a test wrapper that discarded the explicit prompt; correcting that fixture led to green behavior rather than changing production code.
- Focused green: `npx vitest run tests/quick-actions.test.ts tests/chat-view.test.ts` passed 2 files and 19 tests. The first full gate also caught two unnecessary test assertions and a private structural-typing issue when passing the view directly to the availability predicate; explicit state objects and removal of those assertions fixed lint and strict TypeScript checking without changing behavior.
- Full local gate: `npm test` passed 15 files and 235 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real Obsidian verification used the production bundle in ignored `test_vault/stage12_vault`, isolated profile `.emend-test-profile-12`, CDP port 9227, Track Changes, and a CORS-enabled loopback SSE mock on port 8792 with dummy credentials and 1.8-second delayed responses. Existing Obsidian processes and other vault data were not modified.
- With no Markdown target, all three live buttons were disabled. Opening a note enabled them. Each successful click switched from its selected non-Edit mode to Edit, immediately disabled all three actions, changed Send to Stop, displayed the exact mapped user prompt with an Edit badge, and showed an Edit-badged pending assistant message. Every action re-enabled after settlement.
- **Fix grammar:** starting from Ask, the actual mock request contained the complete grammar fixture and mapped prompt. The note became `# Stage 12 Grammar\n\nThis sentence {~~have~>has~~} a grammar error.\n`, and chat showed `Edit applied — 1 changes tracked. Review in Track Changes.`
- **Make concise:** starting from Discuss, the actual request contained the complete concise fixture and mapped prompt. The note became `# Stage 12 Concise\n\n{~~This is a sentence that is unnecessarily very long.~>This sentence is too long.~~}\n`, with the same one-change guarded result.
- **Add examples:** starting from Brainstorm, the first mock fixture accidentally added an unannotated newline and was correctly rejected with `Response reject view differs from the original reject view.` without writing. After confirming the reject-view difference and correcting only the mock to append the insertion token, the same real action succeeded from Brainstorm. The note became `# Stage 12 Examples\n\nA clear example can explain an idea.\n{++For example, a short before-and-after pair shows a grammar fix.++}`, with one tracked change.
- The mock log contained exactly one request per real click, all with `stream: true` and the full-note CriticMarkup system prompt: grammar, concise, the intentionally invalid example response, then the corrected example retry. There was no hidden duplicate request. Persisted successful threads contained visible `mode: 'edit'` user prompts and concise ready assistant results; the validation-error assistant message was not persisted.
- Self-review confirmed that quick actions add no provider, writer, persistence, or pending-registry path; normal submission remains the sole entry point; all existing write guards are untouched; no generated bundle, vault content, mock log, local profile, credential, or other ignored file is staged.
- Implementation commit `482ded14746f111086d8603f42ebe2e61fdb844d`: Gitea run 57 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/57 completed attempt 2 with conclusion **success**. Job 71 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/57/jobs/71 ran on `emend-macos-docker`; checkout, Node/npm verification, `npm ci`, lint, all 235 tests, and the production build succeeded from 13:20:02+08:00 through 13:20:28+08:00. Attempt 1/job 70 failed before checkout when GitHub returned `EOF` while the runner cloned `actions/checkout`; no project step ran.
