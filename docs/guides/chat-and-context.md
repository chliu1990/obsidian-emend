# Chat and context

Use this guide when you want to ask about notes, focus a Selection, add context, or manage chat sessions.

You will learn how to:

- choose bounded Ordinary Chat or complete-note Chat Selection;
- add explicit, read-only Related notes;
- keep separate conversations for one note;
- choose a provider, model, and reasoning effort without submitting;
- check capacity and add vault instructions.

## Chat with the active note

**Outcome:** Ask about the active note without changing it.

Ordinary Chat and Chat Selection are both read-only. Neither has a note writer. The difference is how much context you deliberately send.

| Choice | Active-note context | Selection context | Write access |
| --- | --- | --- | --- |
| **Chat** (Ordinary Chat) | Bounded Markdown around the caret or selection in a long note. Smaller notes are sent whole. | No separate complete-focus section. | None. |
| **Chat · Selection** | The complete note. | A separate copy of the complete captured Selection, used only as read-only focus. | None. |

See [Write permissions](privacy-and-storage.md#write-permissions) for the other workflows and their write boundaries.

**Prerequisites:** Open a Markdown note and configure a provider with [the provider recipe](settings-reference.md#configure-a-provider).

**Actions:**

1. Open Emend chat from the ribbon or Command Palette.
2. Choose **Chat** in **Writing and web search**.
3. Type a question, then press **Enter** or click Send.
4. Wait for the streamed answer. Use **Stop** if you want to cancel it.

**Observable result:** The answer appears in chat, and the note remains unchanged. No edit review is needed because Chat cannot write.

**Recipe recap:** You asked with bounded note context, received a read-only answer, and should observe no note changes.

## Focus on a Selection

**Outcome:** Discuss one passage while giving the model the complete note for context.

Chat Selection is always explicit. Selecting text alone does not choose it.

**Prerequisites:** [Configure a provider](settings-reference.md#configure-a-provider). Select non-whitespace text in the active Markdown note, and keep that Selection available until you submit.

**Actions:**

1. Focus Emend chat without clearing the Selection.
2. Choose **Chat · Selection** in **Writing and web search**.
3. Ask about the selected passage and submit.
4. Read the answer and confirm that the note is unchanged.

An empty, whitespace-only, or vanished Selection stops the submission. Emend shows `Select non-whitespace text first.` before adding messages, saving chats, reading additional notes or instructions, retrieving Web content, or contacting a provider. It never falls back to Ordinary Chat.

**Observable result:** The answer can use the complete note and the complete Selection. The Selection is not truncated to the Ordinary Chat budget, and no note content changes.

**Recipe recap:** You explicitly sent complete-note context plus complete read-only focus, and should observe an answer with no write or silent fallback.

## Add Related notes

**Outcome:** Answer a question with explicit context from other Markdown notes.

**Prerequisites:** [Configure a provider](settings-reference.md#configure-a-provider). Open the target note and Emend chat, then identify the other Markdown notes you want to include.

**Actions:**

1. Click **Related notes**.
2. Choose **All** for vault Markdown paths or **Links** for resolved outgoing and incoming links.
3. Search full paths, then choose individual notes, folders, or **Select all**.
4. Expand **Selected notes** to review paths. Use **Remove** for one path or **Clear all** for the whole selection.
5. Click **Refresh** after changing files or links. Then submit your question.

Folder and Select-all helpers cover the current All or Links scope, including results hidden by search. **Refresh** takes one new path and metadata snapshot. It keeps manual selections and reevaluates the remaining helpers. Links can be incomplete while Obsidian indexes the vault.

Opening, searching, selecting, removing, clearing, and refreshing read no note bodies and make no provider request. Submission reads fresh, bounded, read-only snapshots. The snapshots share the [Context character limit](settings-reference.md#control-context-and-history). Related notes never become edit targets.

**Observable result:** The trigger shows the selected count, and **Selected notes** shows the exact paths. The answer can use those notes, while every note remains unchanged.

**Recipe recap:** You chose explicit paths, reviewed them locally, and should observe bounded read-only context only after submission.

## Use multiple chat sessions

**Outcome:** Keep independent conversations and drafts for the same note.

**Prerequisites:** Open a note and Emend chat. Complete one [Ordinary Chat](#chat-with-the-active-note) exchange before comparing sessions.

**Actions:**

1. Click **New chat session** to start another conversation.
2. Use the **Chat session** selector to switch between sessions.
3. Use **Rename chat session** to set a manual title.
4. Use **Delete chat session** and confirm when you no longer need a session.
5. Reload Obsidian and reopen the note to check persistence.

Each session keeps its own unsent draft, ready messages, and provider history. Switching sessions does not mix those histories. Session management makes no provider request. Reordering is deferred; the current controls have no Move action.

Ready sessions, their order, and the last active session survive reload. Renaming a note does not migrate its saved chats to the new path. Drafts, stopped responses, loading content, and errors do not. See [Local data](privacy-and-storage.md#local-data) for the complete persistence boundary.

**Observable result:** Switching restores the selected session's messages and draft. After reload, ready conversations return and unsent drafts are empty.

**Recipe recap:** You created separate local conversations, and should observe isolated history during use plus ready-message restoration after reload.

## Choose a provider, model, and reasoning effort

**Outcome:** Change the next request's model without submitting your draft.

**Prerequisites:** [Configure a provider](settings-reference.md#configure-a-provider) with a key and usable model. Custom needs both a key and a configured or discovered model.

**Actions:**

1. Click the provider/model/reasoning button between **Writing and web search** and Send.
2. Under **Model**, choose a provider and model.
3. Under **Reasoning effort**, choose **Low**, **Medium**, or **High** for the active provider.
4. Confirm the button summary, then submit separately when ready.

Choosing a model preserves that provider's effort. Choosing an effort preserves its current model. The menu lists only providers with a key and a usable model.

Opening, checking, or dismissing the menu performs no save, discovery, provider request, note-content read, or note write. A choice makes one sanitized local settings save. It performs no network or note I/O and refreshes open chat views and capacity estimates.

Model discovery and custom-model text stay in Settings. Use [Choose or discover a model](settings-reference.md#choose-or-discover-a-model) for those tasks.

**Observable result:** The button names your chosen provider, model, and effort. Your draft remains in place, and no request occurs until you submit.

**Recipe recap:** You changed only local model settings, and should observe an updated composer summary with no network activity or note changes.

## Check context capacity

**Outcome:** Inspect the estimated request budget before submitting.

**Prerequisites:** Configure a valid window and reserve with [the capacity recipe](settings-reference.md#configure-context-capacity).

**Actions:**

1. Type a draft and watch the compact bar below the chat header.
2. Hover or keyboard-focus the bar for estimated input, remaining allowances, and exclusions.
3. If the draft is blocked, reduce its context or history, or adjust the capacity settings.
4. Submit after the bar and Send control show that the draft is allowed.

The estimate uses characters, not exact model tokenization or billing data. It omits some submission-time and later-round content, so the exact submission check remains authoritative. Emend blocks oversized requests instead of compressing them automatically.

**Observable result:** The bar updates with the draft. An over-capacity or invalid configuration disables affected controls and prevents provider requests and note writes.

**Recipe recap:** You inspected a lower-bound local estimate, and should observe blocking rather than automatic compression when the request does not fit.

## Use vault instructions and skills

**Outcome:** Add reusable instructions to explicit provider submissions.

**Prerequisites:** Have a working [Ordinary Chat](#chat-with-the-active-note) setup. You can create files at the vault root and beneath its `skills/` directory.

**Actions:**

1. Create `<Vault>/AGENTS.md` with your instructions.
2. Reference a skill from that file, such as `skills/test-skill`.
3. Add the skill's `SKILL.md` beneath that path.
4. Submit a Chat request and inspect the answer against your instructions.

Emend rereads the root file and safely referenced skills on each request. Skills appear before `AGENTS.md` in the system prompt. Their combined content is capped at 20,000 characters. An unreadable file or truncation produces a Notice without discarding every other readable instruction.

**Observable result:** The next submission includes the readable instructions and skills. Changing them affects later submissions, not earlier saved messages.

**Recipe recap:** You added explicit vault instructions, and should observe their effect on later answers without any background provider request.

## Recap

- **Ordinary Chat** sends bounded note context. **Chat Selection** explicitly sends the complete note plus complete read-only focus.
- Both Chat choices are read-only. Related notes are also read-only and are selected explicitly.
- Sessions isolate drafts and provider history. Ready sessions persist; drafts and unfinished responses do not.
- Composer model choices save locally without network or note I/O. Submission remains a separate action.
- Capacity estimates are approximate and never trigger automatic compression.

Next, review [Privacy and storage](privacy-and-storage.md) for recipients and persistence, or use the [Settings reference](settings-reference.md) to tune these workflows.
