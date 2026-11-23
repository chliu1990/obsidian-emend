# Emend contributor and agent guide

Use this file for durable development rules, not as an exhaustive behavior specification.
Read the architecture contract and relevant stage record before changing behavior.

## Documentation map

| Document | Owns |
| --- | --- |
| [README.md](README.md) and [docs/README.md](docs/README.md) | Product evaluation, current user behavior, and routes into public guides |
| [Chat](docs/guides/chat-and-context.md), [editing](docs/guides/editing-and-review.md), [Web](docs/guides/web-research.md), [privacy](docs/guides/privacy-and-storage.md), and [settings](docs/guides/settings-reference.md) guides | Task-focused user behavior and boundaries |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Technical architecture contract and numbered stage index |
| `devel_docs/<stage>.md` | Exact stage behavior, decisions, test matrices, evidence, and historical limits |
| [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md) | Deferred work, non-goals, and versioned release history |

Use canonical records instead of copying their details into contributor prose:

- Editing: [minimal Operations ranges](devel_docs/37-minimal-edit-ranges.md) and [Selection context](devel_docs/49-selection-focus-and-context.md).
- Providers and Web: [online search](devel_docs/36-deepseek-online-search.md) and [grounded extraction](devel_docs/40-web-content-budget-diagnostics.md).
- Context and UI: [capacity](devel_docs/42-context-accounting-capacity.md) and [Related notes](devel_docs/45-related-notes-explorer.md).
- Cross-cutting hardening and evidence limits: [2.10 stabilization](devel_docs/51-2-10-stabilization.md). Use the stage index for other records.

`devel_docs/future-` files are deferred designs, not current behavior or approval to implement them.
Historical stage records stay unchanged. Update current ownership documents and add new evidence rather than rewriting old results.

## Build and development

Run npm commands from the repository root:

```bash
npm install
npm run dev
npm run build
npm run lint
npm test
```

Use `npm ci` for reproducible installs and CI. `npm run dev` watches and writes `main.js` without type-checking.
`npm run build` runs `tsc -noEmit -skipLibCheck` before the production bundle. `npm test` runs Vitest once.

TypeScript source in `src/` is strict. Preserve all `tsconfig.json` checks and handle missing values instead of suppressing them.

esbuild bundles `src/main.ts` as CommonJS for ES2021. Obsidian, Electron, CodeMirror/Lezer, and Node built-ins are host-supplied.
Bundle every other runtime dependency; add no unbundled dependency or second provider stack.

`main.js`, source maps, `node_modules/`, `test_vault/`, and local `data.json` are gitignored.
Never commit generated bundles, vault content, credentials, mock secrets, or local settings.

## Architecture boundaries

Emend is desktop-only and requires Obsidian 1.11.4 or newer. Keep plugin ID `emend`, view type `emend-chat-view`,
and existing `emend:` command IDs stable.

DeepSeek, Kimi, and custom providers share one OpenAI-compatible streaming `fetch`/SSE transport in `provider-stream.ts`.
Keep provider-specific retrieval in focused adapters; never copy DeepSeek tool schemas to other providers.

The short request-flow map is:

1. `main.ts` maintains the Markdown target, captures synchronous context, registers resources, and owns per-note pending requests.
2. `chat-view.ts` and focused controls manage sessions, drafts, targets, rendering, and submission state.
3. `context.ts`, `selection-context.ts`, `selection-focus.ts`, and `additional-notes-context.ts` assemble declared context.
4. `request-coordinator.ts` separates writer-free Chat and full-note Edit; `selection-editor.ts` coordinates Selection-only edits.
5. `provider-stream.ts` owns SSE transport; `deepseek-web.ts` and `web-*.ts` isolate DeepSeek retrieval and grounded extraction.
6. `operation-edit-strategy.ts`, `markdown-edit-guards.ts`, `replacement-diff.ts`, and `critic-markup.ts` validate and compile edits.
7. `note-writer.ts` and the native Selection adapter are the only writers. `conversation-store.ts` owns sanitized local conversations.
8. `settings.ts` normalizes non-secret settings; `secret-storage.ts` resolves provider credentials.

Keep capture, coordination, transport, writing, persistence, and UI separate.
Put new feature logic in focused modules rather than adding unrelated responsibilities to large modules.

Ordinary Chat uses bounded note context. Chat Selection sends the complete note plus a complete read-only focus Selection.
Full-note Edit sends the complete note. Selection Edit sends the complete Selection with Default Smart/Symmetric
or full-note supporting context. Context never expands the edit target.

Only ready originating-session messages enter configured provider history; drafts and stopped/error/loading states do not.
Same-note requests are serialized across sessions and Modify Selection; different notes are independent.
Note, session, generation, abort, and active-target guards reject stale work.

Related notes are explicit, per-target, session-only, and read-only. Discovery uses paths/metadata without body scans
or background indexing. Content is read at submission and never becomes a write target.
Automatic linked/folder inclusion, TOCs, and background discovery are not current behavior.

Capacity is a local character estimate, not tokenization or billing; the output reserve is never sent as `max_tokens`.
Invalid or excessive capacity fails before networking and at every fetch, without compression, truncation, retry, partial answers, or writes.

Live Selection highlighting uses current editor state without I/O, persistence, mutation, focus changes, or writes.

## Safety, privacy, and persistence invariants

### Write and review boundaries

- Chat, Chat Selection, Web research, session/model controls, and Related-notes discovery have no writer.
  Never route them through an editing coordinator.
- Full-note Edit alone may call guarded `vault.modify`. Selection Edit and Modify Selection may only call native
  `editor.replaceRange` on the captured range, preserving undo. Add no other writer.
- Writers require unchanged source, the same active target, no abort, and Edit permission immediately before writing.
  Full-note writes also compare disk bytes and every open editor. Stale state fails closed.
- Operations are the only model-facing edit protocol, as a closed bare array or `{summary, operations}` envelope.
  Resolve exact original anchors atomically; reject ambiguity, overlap, out-of-target ranges, and additional-note-only anchors.
- Preserve inline-code, fence, table, payload, and CriticMarkup guards. Revalidate compiled markup and the composed
  Selection document before replacement. Never partially apply a rejected candidate.
- Candidate-validation failure gets one same-provider correction with bounded diagnostics. Provider, abort, stale,
  capacity, and write failures get none. Raw candidates and feedback remain private.
- Full annotated responses and rejected-attempt reasoning never enter chat or persistence. Store only concise results,
  optional validated summaries, successful-attempt reasoning, and all-round usage. Never write model summaries into notes.
- Track Changes is the separate companion and only review surface. Emend has no diff/Apply/Reject UI, does not bundle
  or auto-install it, and requires separate design for any missing-plugin affordance.

### Requests, privacy, and credentials

- Provider requests require explicit submission. No background AI requests, telemetry, hidden uploads, remote code execution,
  automatic plugin downloads, or unrelated network calls.
- Send only declared note context, originating-session history, explicit additional notes, and declared instructions/skills.
  Vault-root `AGENTS.md` and referenced skills are request-time instructions, not write targets.
- Paths are opt-in. With path sharing off, prompts contain no paths, basenames, or vault names; local selection UI may show paths.
- Web research is default Off and only supports DeepSeek `deepseek-flash` and `deepseek-v4-pro`.
  Unsupported configurations fail without unsearched fallback. Review exposes editable arguments; Auto skips only that pause.
- Retrieval and model output are untrusted, never instructions or write authorization. The answering model receives source
  metadata plus verified claims with exact quotes, or quotes-only evidence—not raw retrieval or unverified facts.
  Never inject retrieved or model content with `innerHTML`.
- Provisional Web drafts are transient and labelled; they never enter history, copy output, or persistence.
  Raw tool/retrieval data and extractor/verifier/refine artifacts and reasoning also remain transient.
- Store API keys only in SecretStorage through existing provider IDs, with the established memory fallback.
  Sanitized saves keep `apiKey` empty. Never expose keys in URLs, logs, errors, tests, screenshots, or committed data.
- Reject credential-bearing base URLs before requests and redact URL userinfo in errors.
  Do not introduce `requestUrl`, fallback providers, or alternate credential stores.

### Local persistence and failure handling

- Persist only local schema-3 per-note session aggregates through `ConversationStore`.
  Writes are exact-ID, serialized, and atomic; schema 1/2 migrates lazily on the first valid mutation.
- Persist ready messages and sanitized supported metadata, including usage, Web badges/citations/activity, reasoning,
  and concise Edit results. Never persist drafts, transient sessions, non-ready messages, request bodies,
  note/Selection snapshots, raw candidates, or retrieved content.
- Preserve malformed bytes and the first `.corrupt` backup. Refuse unsupported future-schema mutations before writes
  or cleanup. Note deletion leaves its aggregate; rename history migration is not implemented.
- Keep drafts, pending/Web review state, and additional-note selections in memory.
  Stale loads or saves must not recreate deleted sessions or affect newer state.
- Settings saves preserve secrets, sanitize non-secret data, use the shared rejection-tolerant queue,
  and retain settings identities. Failed saves do not partially apply live state.
- Provider usage requires complete consistent triplets; otherwise label character estimates as estimated.
  Never invent retrieval charges, model limits, pricing, or token counts.

## Coding conventions

Follow existing TypeScript style: tabs, single quotes, semicolons, trailing commas, and `async`/`await`.
Match nearby naming and structure. Avoid narration comments and update stale comments.

Use Obsidian DOM helpers and `MarkdownRenderer`, short sentence-case copy, and correct owner-document/animation-frame APIs.
Register views, extensions, events, commands, scopes, and disposables through Obsidian helpers.

Abort requests, close transient UI, and cancel renders on view close. Guard callbacks against stale notes, sessions,
generations, controls, and disconnected elements. Preserve drafts, caret, focus, and reader position across targeted updates.

Use Obsidian CSS variables and the `emend-` prefix; update selectors and styles together.

Keep the composer limited to Chat and Edit; Discuss/Brainstorm belong only in history or normalization.
Chat Selection is explicit, never inferred from selected text. Quick actions and Modify Selection reuse guarded submission paths.

Only documented Search/Fetch, candidate-validation, and reader-format bounded retries are allowed.
Do not revive silent retries, legacy JSON edits, inline suggestions, in-plugin diffs, or automatic edits.

When changing documented behavior, update this file and the owning guide in the same PR.
Historical stage descriptions never override later invariants.

## Testing and verification

Unit tests use Vitest under `tests/`, with Obsidian mocked by `tests/mocks/obsidian.ts`.
They must not access a real vault or network. Add focused regression tests for behavior changes, including failure, abort,
stale-source, privacy, and persistence boundaries where relevant.

Chat-view behavioral tests construct real `EmendChatView` instances and use public lifecycle, submission, session, target,
and refresh methods together with rendered DOM and provider/conversation-store boundaries. Use the shared public fixture;
do not add private-prototype access, hand-built view contexts, private-field casts, or test-only production accessors.
Unmigrated cases in `tests/chat-view.test.ts` remain legacy coverage, not a pattern to extend; migrate any legacy case
touched by later work to the public seam. See [Stage 54](devel_docs/54-public-chat-view-test-seam.md).

Run the standard local gate:

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

With dependencies already installed and an unchanged lockfile, `npm ci` may be omitted.
Documentation-only tasks may use their task-specific content, link, anchor, size, and diff checks instead of claiming runtime verification.

Manual verification belongs only in ignored `test_vault/`, with synthetic notes, local SSE and DeepSeek Search/Fetch mocks,
CORS, and dummy credentials. Never use real accounts, paid calls, private notes, personal paths, or other vaults.
Install the built plugin files only in that vault.

Exercise actual requests and writes, inspect note bytes and native undo, and assert root/loaded bundle identity when supported.
Distinguish unit, loopback, and real-provider evidence. Record platform, Obsidian, theme, input, screen-reader,
and provider limits honestly; never claim unexercised environments or real-provider coverage.

Provider, persistence, write-path, credential, and CI/workflow changes require independent code/security review,
even with one maintainer. Documentation claims about those boundaries need factual review against current source and stage records.

Use stage records for scenario matrices and commands rather than duplicating them here.
New evidence belongs in a new current record or explicit addendum that does not falsify historical results.

## Documentation, PRs, and releases

Keep each PR focused on one independently reviewable behavior. Update the canonical owner for every changed claim,
preserve descriptive links and anchors, and run the local link/anchor audit. Do not move removed prose wholesale into another guide
or repeat test totals, bundle hashes, and verification matrices outside stage records.

Public documentation must distinguish current behavior, tested environments, and deferred designs.
Do not claim exact tokenization, universal Web support, automatic discovery, total locality, or unexercised verification.
Keep installation and release examples version-neutral outside release PRs.

Feature and documentation PRs do not bump versions, create tags, publish releases, change workflows,
or submit to the Community Directory. Release work stays separate with synchronized `package.json`, `package-lock.json`,
`manifest.json`, `versions.json`, and `CHANGELOG.md` updates.

Use `npm version <patch|minor|major>` for release metadata. Tags exactly match `manifest.json`, without a leading `v`.
The release workflow publishes `main.js`, `manifest.json`, `styles.css`, and the packaged plugin ZIP after verification;
see [the release contract](IMPLEMENTATION_PLAN.md#verification-and-release-process).

Report private vulnerabilities through [SECURITY.md](SECURITY.md), not public issues or sample data.
Follow [CONTRIBUTING.md](CONTRIBUTING.md) for human PR flow and [ROADMAP.md](ROADMAP.md) for priorities and non-goals.
