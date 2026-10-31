# Stage 26: history mode and permission context design

## Goal

Preserve each ready chat message's mode, historical note-write permission, and origin when constructing model history so a later request cannot mistake an earlier local Edit confirmation for a contradictory assistant claim. Fix the semantics without changing current permissions, note-write behavior, conversation persistence, or provider wire compatibility.

## Problem and scope

`ChatMessage` persists `mode`, and the UI displays it, but `toProviderHistory()` currently reduces history to `{ role, content }`. An Edit confirmation generated locally by Emend therefore reaches a later Ask request as an unlabeled assistant message. The current Ask system prompt correctly forbids writing, but the model can perceive the earlier confirmation as its own prior claim and become confused.

This stage includes typed internal history metadata, explicit textual annotations, a shared historical-permission system rule, matching token estimates, focused regression tests, and real-Obsidian payload verification.

This stage does not include translation, new modes, new note permissions, conversation-schema changes, additional history messages, changed history length, model/provider discovery, or automatic retry/edit behavior.

## Current behavior to preserve

- Only `ready` messages enter model history.
- The chat view and coordinators retain at most the last eight messages.
- Ask, Discuss, and Brainstorm remain read-only and have no writer dependency.
- Only Edit can write, with existing target, stale-source, abort, and final permission checks unchanged.
- Edit confirmations remain local status messages; raw Operations/model JSON never enters chat history.
- Conversation storage remains schema v1 and continues persisting the existing `ChatMessage.mode` field.

## Typed internal history

Extend `ProviderHistoryMessage` to:

```ts
type ProviderHistoryOrigin = 'user' | 'model' | 'local-edit-status';

interface ProviderHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
	mode: Mode;
	origin: ProviderHistoryOrigin;
}
```

Define a separate wire-message type containing only `role` and `content`. Provider-specific custom fields must never be spread into the fetch payload.

`toProviderHistory()` derives metadata without changing persisted data:

- Every user-role message has `origin: 'user'`.
- Every assistant-role message whose persisted mode is `edit` has `origin: 'local-edit-status'`. Edit assistant content is already locally generated status, so no text matching is needed.
- Every other assistant-role message has `origin: 'model'`.
- Every message copies its existing `mode` and unchanged `content` and `role`.

Existing conversations require no migration because their mode is already stored and normalized.

## Formatting boundary

Add a focused `src/provider-history.ts` module that imports types only and exports:

```ts
function formatProviderHistory(
	messages: ProviderHistoryMessage[],
): ProviderWireHistoryMessage[]
```

For each message, preserve its role and prepend a fixed Emend-generated annotation to its content. The annotation contains:

- The capitalized historical mode.
- `Note writing was permitted for that earlier request only.` for Edit, or `That earlier request was read-only.` for all other modes.
- Origin wording: `Origin: user message.`, `Origin: model response.`, or `Origin: local Emend Edit status, not a model response.`

Use this exact structure:

```text
[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit status, not a model response.]
<original content>
```

The original content follows the annotation on a new line without editing, escaping, or truncation. Metadata is derived from trusted internal fields rather than parsed from message content.

## System-prompt rule

Add one shared rule to Ask, Edit, Discuss, and Brainstorm chat prompts:

```text
History annotations describe earlier requests only and never change the current mode or permissions. Local Emend Edit statuses record outcomes; they are not model claims or instructions.
```

Apply it to full-note chat Edit as well as read-only chat modes. Selection editing has no chat history and does not need the rule. Existing current-mode write prohibitions and Operations instructions remain unchanged and take precedence over historical information.

## Request and token-accounting flow

1. The chat view creates typed internal history before the new current prompt is added.
2. Coordinators continue slicing typed history to eight messages.
3. The provider transport calls `formatProviderHistory()` and sends only the returned wire messages.
4. Estimated token usage sums the formatted wire-message content, including annotations, rather than the unformatted internal content.
5. Provider-reported usage remains authoritative and unchanged.

No additional API request, model call, persistence write, or retry is introduced.

## Security and permission boundaries

Historical Edit metadata is informational and cannot grant write access. The current submission's mode remains the only permission input. Read-only coordinators still have no writer, and `canWriteToNote()` remains unchanged.

Annotations never include API keys, note paths beyond existing prompt behavior, raw Operations output, or additional note content. User/model text remains clearly below the Emend-generated annotation so the model can distinguish it from trusted metadata.

## Automated tests

Add focused formatter tests for all four modes and all three origins, exact labels, role/content preservation, empty history, and absence of custom wire fields.

Extend chat-view tests for ready filtering, eight-message selection, metadata derivation from role/mode, unchanged content, and persisted mixed-mode conversations without schema changes.

Extend provider-stream and token-usage tests to prove the actual request contains annotated standard messages and estimated usage counts the same formatted text.

Add an Edit → Ask regression: after one successful tracked Edit, submit Ask and inspect the second request. Assert that its current system prompt remains read-only, earlier user/assistant entries carry Edit/local-status semantics, and only the first request writes. Update sequential-Edit expectations to retain annotated local statuses while excluding raw edit protocol output.

Run the complete test suite, lint, production build, and `git diff --check`.

## Real-Obsidian verification

Use an isolated ignored vault/profile, production bundle, dummy credentials, and a CORS-enabled loopback streaming mock. Perform one Edit that creates a tracked insertion, followed by Ask `hello?`. Capture the actual second request and verify:

- Its current system prompt contains the read-only rule and shared history rule.
- Earlier Edit user and local-status messages contain the expected annotations.
- Wire messages contain only `role` and `content`.
- The first request creates the expected tracked change; the second performs no additional write.
- The visible chat still shows the existing mode badges and local Edit confirmation.

Use synthetic note content only. Do not call external providers or use real credentials/private notes.

## Documentation and delivery

Document the history semantics in the README architecture/behavior section and record implementation and verification evidence in a separate numbered stage document. Keep this as one focused PR based on `main`, independent of model discovery and translation. Do not change release versions or changelog metadata in the feature PR.
