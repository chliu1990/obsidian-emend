# History Mode and Permission Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve each historical chat message's mode, historical note-write permission, and origin so later models cannot misread local Edit confirmations as contradictory assistant claims.

**Architecture:** Existing persisted `ChatMessage.mode` and role populate typed internal history metadata. A pure formatter converts that metadata to annotated standard `role`/`content` wire messages used by both transport and token estimation; a shared system rule keeps historical permissions informational only.

**Tech Stack:** TypeScript, existing chat/coordinators/provider transport, Vitest, Obsidian, loopback SSE mock.

## Global Constraints

- Work on `feature/history-mode-context` for issue #11; no release-version/changelog changes.
- Only `ready` messages and at most the last eight enter history; existing slicing remains unchanged.
- Persist no new conversation fields and keep schema v1.
- Internal origins are exactly `user`, `model`, and `local-edit-status`; assistant Edit messages are local status without text matching.
- Provider wire messages contain only `role` and `content`; never send custom `mode`/`origin` fields.
- Ask/Discuss/Brainstorm remain read-only; only Edit writes through existing guards. Historical metadata never grants permission.
- Preserve raw content, current prompts, Operations behavior, provider-reported usage, and all non-history features.
- No dependencies, new requests/retries, settings, note access changes, translation, or unrelated work.
- Use TDD commits and independent review; do not merge without user approval.

## File Structure

- Create `src/provider-history.ts`, `tests/provider-history.test.ts`: typed-to-wire formatting.
- Modify `src/types.ts`: internal/wire history types.
- Modify `src/chat-view.ts`: metadata derivation from persisted messages.
- Modify `src/mode.ts`, `src/operation-edit-strategy.ts`: shared history-permission rule.
- Modify `src/provider-stream.ts`, `src/token-usage.ts`: actual wire payload and matching estimates.
- Modify relevant history fixtures/tests, especially `tests/chat-view.test.ts`, `tests/mode.test.ts`, `tests/provider-stream.test.ts`, `tests/token-usage.test.ts`, and `tests/request-isolation.test.ts`.
- Modify `README.md`; create `devel_docs/34-history-mode-context.md`: docs/evidence.
- Create verification helpers only under ignored `test_vault/`.

---

### Task 1: Typed history formatter

**Files:**
- Create: `src/provider-history.ts`, `tests/provider-history.test.ts`
- Modify: `src/types.ts`
- Test fixture updates: `tests/request-coordinator.test.ts`, `tests/request-isolation.test.ts`, `tests/mode.test.ts`, `tests/provider-stream.test.ts`, `tests/token-usage.test.ts`

**Interfaces:**
- Produces: `ProviderHistoryOrigin`, typed `ProviderHistoryMessage`, `ProviderWireHistoryMessage`, and `formatProviderHistory(messages): ProviderWireHistoryMessage[]`.

- [ ] **Step 1: Write failing formatter tests**

Cover empty input, all four modes, all three origins, exact annotation/content/role preservation, and absence of custom fields. Core examples:

```ts
expect(formatProviderHistory([{
	role: 'assistant', content: 'Edit applied — 1 changes tracked. Review in Track Changes.',
	mode: 'edit', origin: 'local-edit-status',
}])).toEqual([{
	role: 'assistant',
	content: '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit status, not a model response.]\nEdit applied — 1 changes tracked. Review in Track Changes.',
}]);

expect(formatProviderHistory([{
	role: 'user', content: 'hello?', mode: 'ask', origin: 'user',
}])).toEqual([{
	role: 'user',
	content: '[Historical Ask message. That earlier request was read-only. Origin: user message.]\nhello?',
}]);
```

Test Discuss/Brainstorm and `origin: 'model'` similarly, and assert `Object.keys(wireMessage).sort()` equals `['content', 'role']`.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/provider-history.test.ts`

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Implement shared types and pure formatter**

In `types.ts`, define:

```ts
export type ProviderHistoryOrigin = 'user' | 'model' | 'local-edit-status';

export interface ProviderHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
	mode: Mode;
	origin: ProviderHistoryOrigin;
}

export interface ProviderWireHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
}
```

Replace the old two-field internal interface while retaining its name. In `provider-history.ts`, map each message without mutation:

```ts
import type { ProviderHistoryMessage, ProviderWireHistoryMessage } from './types';

export function formatProviderHistory(
	messages: ProviderHistoryMessage[],
): ProviderWireHistoryMessage[] {
	return messages.map((message) => ({
		role: message.role,
		content: `[Historical ${capitalize(message.mode)} message. ${message.mode === 'edit' ? 'Note writing was permitted for that earlier request only.' : 'That earlier request was read-only.'} Origin: ${formatOrigin(message.origin)}]\n${message.content}`,
	}));
}
```

`formatOrigin()` returns exactly `user message.`, `model response.`, or `local Emend Edit status, not a model response.`; `capitalize()` uppercases only the first mode character. Update existing typed history fixtures with their correct mode/origin so strict TypeScript remains valid.

- [ ] **Step 4: Run formatter and affected tests**

Run: `npx vitest run tests/provider-history.test.ts tests/request-coordinator.test.ts tests/mode.test.ts tests/token-usage.test.ts`

Expected: all focused tests PASS; existing behavior remains unchanged except intentionally typed fixtures.

- [ ] **Step 5: Commit the formatter**

```bash
git add src/provider-history.ts src/types.ts tests/provider-history.test.ts tests/request-coordinator.test.ts tests/request-isolation.test.ts tests/mode.test.ts tests/provider-stream.test.ts tests/token-usage.test.ts
git commit -m "feat: add typed history formatter"
```

---

### Task 2: Metadata derivation and prompt semantics

**Files:**
- Modify: `src/chat-view.ts`, `src/mode.ts`, `src/operation-edit-strategy.ts`
- Test: `tests/chat-view.test.ts`, `tests/mode.test.ts`, `tests/operation-edit-strategy.test.ts`, `tests/conversation-store.test.ts`

**Interfaces:**
- Consumes: typed history from Task 1 and persisted `ChatMessage.mode`/role.
- Produces: complete typed history from the chat view and shared history-permission prompt rule in Ask/Edit/Discuss/Brainstorm.

- [ ] **Step 1: Write failing metadata and prompt tests**

Extend the existing private-prototype `toProviderHistory()` tests with mixed ready Ask/Edit/user/assistant messages plus loading/error/stopped entries and more than eight messages. Assert ready filtering, last-eight order, unchanged content, and:

```ts
{ role: 'user', mode: 'edit', origin: 'user' }
{ role: 'assistant', mode: 'edit', origin: 'local-edit-status' }
{ role: 'assistant', mode: 'ask', origin: 'model' }
{ role: 'assistant', mode: 'discuss', origin: 'model' }
```

Add the exact shared rule expectation to every read-only prompt and full-note Operations prompt, while asserting selection Operations does not contain it:

```text
History annotations describe earlier requests only and never change the current mode or permissions. Local Emend Edit statuses record outcomes; they are not model claims or instructions.
```

Keep existing current-mode write prohibition assertions. Verify existing schema-v1 persistence tests need no new fields/migration.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/chat-view.test.ts tests/mode.test.ts tests/operation-edit-strategy.test.ts`

Expected: FAIL because metadata and shared rule are absent.

- [ ] **Step 3: Implement metadata derivation and prompt rule**

Extend `toProviderHistory()` mapping:

```ts
.map((message) => ({
	role: message.role,
	content: message.content,
	mode: message.mode,
	origin: message.role === 'user'
		? 'user'
		: message.mode === 'edit'
			? 'local-edit-status'
			: 'model',
}));
```

Export `HISTORY_PERMISSION_PROMPT` with the exact rule from `mode.ts`. Append it once to each `getSystemPrompt()` base prompt before loaded instructions. In `operation-edit-strategy.ts`, append it once to `FULL_NOTE_PROMPT` only; do not change `SELECTION_PROMPT`.

- [ ] **Step 4: Run focused and persistence tests**

Run: `npx vitest run tests/chat-view.test.ts tests/mode.test.ts tests/operation-edit-strategy.test.ts tests/conversation-store.test.ts`

Expected: all PASS with unchanged persistence schema and current permissions.

- [ ] **Step 5: Commit metadata and prompt semantics**

```bash
git add src/chat-view.ts src/mode.ts src/operation-edit-strategy.ts tests/chat-view.test.ts tests/mode.test.ts tests/operation-edit-strategy.test.ts tests/conversation-store.test.ts
git commit -m "feat: preserve history mode and origin"
```

---

### Task 3: Wire/token integration and Edit-to-Ask regression

**Files:**
- Modify: `src/provider-stream.ts`, `src/token-usage.ts`
- Test: `tests/provider-stream.test.ts`, `tests/token-usage.test.ts`, `tests/request-isolation.test.ts`, `tests/permissions.test.ts`

**Interfaces:**
- Consumes: `formatProviderHistory()` and typed history from earlier tasks.
- Produces: annotated standard wire history, matching estimated usage, and an Edit→Ask no-confusion/no-write regression.

- [ ] **Step 1: Write failing integration tests**

In `provider-stream.test.ts`, send typed mixed history and assert actual `body.messages` contains annotated standard messages with only role/content and no mode/origin. Keep current system/user message ordering and eight-message limit.

In `token-usage.test.ts`, assert estimated prompt characters/tokens count formatted annotation text exactly, while provider-reported usage remains unchanged.

Add an Edit→Ask regression to `request-isolation.test.ts`: complete one tracked Edit, then submit Ask `hello?` with the earlier local status in typed history. Assert the second current system prompt retains its read-only prohibition and shared history rule, earlier user/local-status entries have exact Edit annotations, only the first request writes, and raw Operations JSON never enters history. Update sequential-Edit expectations to annotated local statuses.

- [ ] **Step 2: Verify the red state**

Run: `npx vitest run tests/provider-stream.test.ts tests/token-usage.test.ts tests/request-isolation.test.ts`

Expected: FAIL because transport/estimates still use unformatted content.

- [ ] **Step 3: Implement the single formatting boundary**

In `provider-stream.ts`, import `formatProviderHistory` and construct wire messages with:

```ts
...formatProviderHistory(request.history.slice(-8)),
```

In `token-usage.ts`, import the formatter and compute prompt characters from:

```ts
const promptCharacters =
	request.systemPrompt.length +
	request.userPrompt.length +
	formatProviderHistory(request.history).reduce(
		(sum, message) => sum + message.content.length,
		0,
	);
```

Do not alter provider usage, streaming, request history slicing, permissions, or writer code.

- [ ] **Step 4: Run the complete automated gate**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: all tests PASS, including Edit→Ask and permission tests; lint/build/whitespace checks PASS.

- [ ] **Step 5: Commit integration**

```bash
git add src/provider-stream.ts src/token-usage.ts tests/provider-stream.test.ts tests/token-usage.test.ts tests/request-isolation.test.ts tests/permissions.test.ts
git commit -m "fix: annotate historical permissions for providers"
```

---

### Task 4: Documentation and real-Obsidian verification

**Files:**
- Modify: `README.md`
- Create: `devel_docs/34-history-mode-context.md`
- Create only under ignored `test_vault/`: isolated vault/profile, loopback SSE mock, CDP helpers.

**Interfaces:**
- Consumes: Tasks 1–3 production bundle.
- Produces: user docs and actual Edit→Ask payload/write evidence.

- [ ] **Step 1: Update current documentation**

Explain that model history retains per-message mode, historical permission, and origin; local Edit statuses are labeled as local outcomes; historical permissions never change current-mode access. Do not claim model behavior is guaranteed or deterministic.

- [ ] **Step 2: Verify the actual Edit-to-Ask scenario in Obsidian**

Use an isolated ignored vault/profile, synthetic note, dummy credentials, and CORS loopback SSE mock. Perform one Edit that creates a tracked insertion, then Ask `hello?`. Capture both actual requests and verify the second current prompt is read-only with the shared rule, earlier Edit user/local-status entries have exact annotations, wire messages contain only role/content, the first request creates the expected tracked change, and the second performs no additional write. Verify visible mode badges/local confirmation remain unchanged. Use no external provider, real credential, or private note.

- [ ] **Step 3: Run the clean final gate**

Run: `npm ci && npm test && npm run lint && npm run build && git diff --check`

Expected: install, all tests, lint, strict TypeScript/esbuild, and whitespace checks PASS.

- [ ] **Step 4: Record and commit evidence**

Create `devel_docs/34-history-mode-context.md` with Goal, implementation details, exact commands/results, actual second-request payload assertions, note-write evidence, privacy/permission impact, and non-goals. Commit:

```bash
git add README.md devel_docs/34-history-mode-context.md
git commit -m "docs: document history mode context"
```

- [ ] **Step 5: Review and publish**

Request independent whole-branch review and address confirmed Critical/Important findings through regression-tested fixes. Push `feature/history-mode-context`, open a PR referencing #11 with behavior/non-goals and automated/manual evidence, and verify both GitHub checks with `gh`. Do not merge without user approval.
