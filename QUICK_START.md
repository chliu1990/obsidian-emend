# Emend quick start

Use this guide after installing Emend with [INSTALLATION.md](INSTALLATION.md). It uses a small test note so you can verify chat, guarded editing, Track Changes, and selection editing on your machine.

## 1. Prepare a safe test note

Create a separate test vault or a disposable note in an existing vault. Start with:

```markdown
# Emend test

This sentence have a small grammar problem.

## Ideas

- First idea
- Second idea
```

Keep another copy if you want to compare results. Emend's read-only modes never edit notes; Edit mode and Modify Selection write validated CriticMarkup for Track Changes review.

## 2. Configure a provider

Open **Settings → Emend**, choose a provider, and fill in its settings.

### DeepSeek

- Base URL: `https://api.deepseek.com`
- API key: your DeepSeek key
- Model: `deepseek-flash`; replace the preset if your account uses a different name

### Kimi

- Base URL: `https://api.kimi.com/coding/v1`
- API key: your Kimi Code key
- Model: `k3.1-pro`; replace the preset if needed

### Custom OpenAI-compatible provider

- Base URL: the provider's OpenAI-compatible root, such as `http://localhost:11434/v1`
- API key: the provider key, or a dummy value if your local server only requires a nonempty key
- Model: a model available on that server

Emend appends `/chat/completions` to the base URL. The provider must support streaming. Reasoning effort defaults to **High**; choose another level if the model does not support it. **Request token usage** is enabled for DeepSeek/Kimi and disabled for custom providers. Disable it if your provider rejects `stream_options`.

API keys are stored in Obsidian SecretStorage, not as plaintext in Emend's `data.json`. Existing plaintext keys migrate automatically on load. Clearing a key in settings removes that provider's stored credential; removing the plugin folder alone does not. Do not use a real key in screenshots or shared test files.

The editable presets above are DeepSeek `deepseek-flash` and Kimi `k3.1-pro`. Operations is the only editing protocol; there is no CriticMarkup strategy selector. DeepSeek `deepseek-flash` and `deepseek-v4-pro` support default-off **Web: Review / Auto** research in read-only chat; other providers and editing paths do not. Automatic context compression and other-provider search adapters remain deferred; see the [context-management roadmap](devel_docs/future-context-management.md) and [remaining web-search work](devel_docs/future-web-search.md).

### Context capacity (optional)

Set **Context window (tokens)** and **Output reserve (tokens)** manually, or explicitly click **Use documented defaults** when that action is available. Both are required together, must be positive integers, and the window must be larger than the reserve; effective input capacity is `window − reserve`. Leave both empty, or use **Clear capacity settings**, to turn capacity checks off. An invalid pair shows a warning in settings and blocks requests until you fix it. The reserve is local accounting only — it is never sent as `max_tokens`.

Emend does not infer or fetch limits. The documented-defaults catalog contains only DeepSeek `deepseek-flash` and `deepseek-v4-pro` at window `1048576` / reserve `393216` (1M context, 384K maximum output), and Kimi `k3.1-pro` at window `1048576` / reserve `131072` (up to 1M context on eligible plans and 131,072 default output; lower-tier plans may need a smaller window). These are model documentation values, not a response from your account. The button overwrites existing values only when clicked; model selection and settings loading apply nothing automatically, custom and unknown models remain manual, and no provider metadata call is added.

The composer then shows a **Draft estimate** of the next request: estimated input tokens against effective capacity, with folded per-category details. It updates as you type, move the caret, change mode or **Edit target**, select additional notes, or change settings. Draft estimates leave out loaded instructions/skills, additional-note contents, the first Web round's system prompt and tool declarations, and later Web or correction rounds, so the exact check at submission still decides.

When a draft is at or above capacity, Send and the affected quick actions are disabled and **Enter**/**Mod+Enter** show a notice instead of submitting; nothing is sent and nothing is written. A request rejected by the exact check shows a capacity error with guidance (reduce context, history, additional notes, or Web output, use a smaller selection, or select a smaller target), adds no answer, writes nothing, and can be retried after you reduce the request or raise the limit. Emend never compresses, summarizes, or truncates context to make a request fit.

## 3. Test read-only chat

1. Open the test note.
2. Select the Emend ribbon icon or run **Open Emend chat** from the Command Palette.
3. Select **Ask** and send:

   ```text
   What is the main topic of this note? Reply with one sentence and show $x^2$ as inline math.
   ```

4. Confirm that the answer streams into chat, reasoning is folded when present, and the note does not change.
5. Try **Discuss** and **Brainstorm**. These modes also leave the note unchanged.
6. Click **Add notes** and explicitly choose another Markdown note in the picker. Its path appears under **Additional notes**; use **Remove** or **Clear all** to change the selection. Opening the picker, choosing a note, and switching notes do not send a provider request.
7. Submit another question and confirm that the response can use the selected note while neither the active note nor the additional note changes. Additional-note content is read-only context in every mode, including Edit and Modify Selection.

Selections are independent for each active target note, survive switching between notes during the current plugin session, and clear when the Emend plugin or Obsidian reloads. They are not saved in conversations or plugin settings. Renaming a selected note updates its path; deleting it removes it from visible selections. If a selected path goes missing before capture, the request fails safely before contacting the provider, so remove the missing entry and retry.

The current **Context size** setting is a separate combined source-character budget for all additional notes. Emend divides the remaining budget fairly in selection order and gives unused capacity from shorter notes to later notes. Large notes are included from their beginnings with `[...]` at omitted edges. The active-note and selection-context budgets behave as before.

Useful controls:

- **Enter** or **Cmd+Enter** sends on macOS; **Ctrl+Enter** sends on Windows/Linux.
- **Shift+Enter** inserts a newline.
- **Cmd+Shift+A/E** on macOS or **Ctrl+Shift+A/E** on Windows/Linux selects Ask/Edit without sending.
- **Stop** aborts an in-flight request. **Copy** copies a completed answer.

### Draft estimate and blocked requests

When capacity is configured, the **Draft estimate** below the composer input reads `Estimated input: N tokens of M effective capacity.` and updates on typing, caret or selection moves, mode and **Edit target** changes, additional-note changes, and settings changes. Expand **Estimate details** for the window, reserve, and per-category tokens. The estimate leaves out loaded instructions and skills, additional-note contents, the first Web round's system prompt and tool declarations, and later Web or correction rounds, so a passing draft can still be rejected by the exact submission check.

At or above capacity, or with an invalid window/reserve pair, Send and the affected quick actions are disabled and **Enter**/**Mod+Enter** show a notice instead of sending. A rejected request shows a capacity error naming the required input and the effective capacity, adds no answer, and writes nothing; reduce the draft, chat history, target, or additional notes, or raise the limit, then retry. The Command Palette selection modal shows the same meter for its captured selection.

## 4. Test a full-note edit

1. Select **Edit** in chat. If text is selected, change **Edit target** from its automatic **Selection** value to **Full note**, then send:

   ```text
   Correct the grammar mistake and add one short third idea.
   ```

2. Confirm that chat shows an edit confirmation rather than the full rewritten note.
3. Open the Track Changes review surface. You should see the correction and insertion as reviewable changes. Even if the model replaces a whole sentence or paragraph, Emend reduces the review markup to deterministic word/segment-level hunks where practical; it does not produce character-minimal fragments.
4. Accept or reject the changes in Track Changes. Emend itself has no Apply/Reject buttons.

For quick actions, select **Fix grammar**, **Make concise**, or **Add examples** above the composer. Each switches to Edit and submits one visible request through the same guarded path.

An invalid candidate causes exactly one automatic correction request to the same provider, so one submission can make at most two provider calls. The correction includes the unchanged original request, the invalid response, and bounded actionable validation feedback. A second invalid response writes nothing and shows the final diagnostic. Provider errors, Stop, stale notes, and write failures do not trigger another correction round. Composer Edit token usage, including Selection, covers every attempted round.

## 5. Test selection-only editing

1. Select only `This sentence have a small grammar problem.` and focus Emend chat. **Edit target** automatically displays **Selection**; with no usable selection it displays **Full note**. The automatic choice resets when the actual target note changes, while an explicit choice survives same-note renders and mode switches.
2. Select **Edit** and enter:

   ```text
   Correct the grammar without changing the meaning.
   ```

   Alternatively, use **Fix grammar**, **Make concise**, or **Add examples** above the composer. Each quick action enters Edit and submits once through the same target selection. Choose **Full note** explicitly whenever you want the ordinary whole-note path instead.
3. Confirm that only the selected sentence receives CriticMarkup. The heading and idea list must remain unchanged. Selection replacements use the same word-aware multi-hunk minimization and single validation-correction round as full-note Edit, with the configured recent ready history, the complete selection, and only surrounding context beyond it.
4. Confirm that chat shows the concise tracked-change result, its `Target: Selection.` line, any model-written summary, reasoning, and token usage rather than the annotated selection. Review it in Track Changes, or press **Cmd+Z** on macOS (**Ctrl+Z** on Windows/Linux) to undo the native editor replacement.
5. Try submitting with **Selection** explicitly chosen but no selection, a whitespace-only selection, or a selection that vanished before submission. Emend shows `Select non-whitespace text first.` and adds no chat message, saves no message, makes no provider request, and performs neither a selection nor full-note write.

The separate **Modify selected text with AI** Command Palette workflow is unchanged. It opens the existing instruction modal with the same quick actions and additional-note controls, privately buffers the response, and shows its normal result/error notices without adding a composer chat result, usage footer, or retry-status display. It uses the same guarded selection coordinator and native undo.

**Smart selection context** is enabled by default. Emend can send the containing paragraph for context, but it never expands the replacement target.

## 6. Understand operation-based editing

Every full-note and selection edit asks the model for a closed JSON array of `insert`, `remove`, `replace`, and `comment` commands. Emend validates exact anchors and occurrences, rejects ambiguous or overlapping commands, compiles valid commands into CriticMarkup, and uses the same Track Changes review path. Typed diagnostics identify precise failure codes, operation numbers, and bounded match details. Existing declared-range overlap and insertion-ambiguity checks remain conservative after minimization. Operations are the only model-facing edit protocol; there is no edit-strategy setting.

Structural guards reject partial inline-code targets (`inline-code-range`), fenced-code edits (`fenced-code-edit`), and table structure changes (`table-structure-edit`) before any write. Backtick-containing replacements use whole-target markup so delimiters stay reviewable. Tables allow only text edits within one existing header/body cell; escaped pipes and safe cell insert/remove/replace/comment Operations remain available. Selection classifies structure against the full note without expanding its target.

Raw markup shown while the cursor is inside a table cell is upstream Obsidian/Track Changes presentation behavior. Use exact accept/reject results—not that live presentation—to verify correctness.

The minimizer shares a bounded work budget across each response and falls back to one substitution for the changed middle when a detailed diff would be too expensive. Correction requests are transient implementation details: raw operations, rejected candidates, and diagnostic feedback do not appear in ready chats or stored threads. After a retry, composer Edit chat—including Selection—keeps only the successful attempt's reasoning and shows all-round usage. The separate selection modal still has no usage footer or retry-status UI.

## 7. Test instructions and skills

Create `<Vault>/AGENTS.md`:

```markdown
Follow the user's language and keep edits minimal.

A test skill is installed at `skills/test-skill`.
```

Create `<Vault>/skills/test-skill/SKILL.md`:

```markdown
When editing, prefer concise sentences.
```

Send another request. Emend rereads these files on every request and places skill instructions before `AGENTS.md` in the system prompt. Only vault-root `AGENTS.md` and referenced Markdown files beneath `skills/` are loaded.

## 8. Verify persistence and privacy behavior

- Ask different questions in two notes, switch between them, and reload the Emend plugin or Obsidian. Each note should restore its own conversation, while its additional-note selections are empty after either reload.
- Saved chats are under `<Vault>/.obsidian/emend/chats/`. They contain ready chat messages, not API keys, active/additional-note snapshots, captured selection text or offsets, additional-note selections/snapshots, or buffered edit responses.
- Additional-note paths are always shown locally in the picker controls so you can review what is selected. With **Include note path** off, provider prompts use only generic labels such as `Additional note 1`; with it on, each section includes `Path: <vault>/<note path>`. Selected content is sent with either setting when you explicitly submit.
- Enable **Include note path** only if you want the vault/note path sent to the provider for both active and additional notes.
- Full-note Edit always sends the complete active note. Read-only modes send bounded active-note context. Composer Selection sends the complete selection plus surrounding context and the recent ready history; Modify Selection sends the same selection context without history. All can include separate bounded, read-only additional-note snapshots, but Operations can target only the captured active note or selection. **Chat history messages** defaults to 8 and accepts 0–50; 0 disables history.
- Capacity window and reserve values, and the invalid marker, are ordinary non-secret provider settings that persist across restarts. Draft estimates are never stored, and they are approximations rather than provider billing data.
- Deleting a note does not delete its saved conversation automatically.

## Verification checklist

You have completed the quick start when:

- Ask, Discuss, and Brainstorm stream answers without changing the note.
- Edit writes reviewable CriticMarkup, not an in-plugin diff.
- Track Changes can accept or reject the edit.
- Composer Selection and Modify Selection change only the captured selection, native undo works, and Selection capture failures never fall back to Full note.
- Explicitly selected additional notes appear with their paths, remain read-only, respect context/path limits, and never leak between target notes.
- If you configured capacity, the Draft estimate updates live and an over-capacity or invalid configuration blocks submission with no provider request and no note write.
- Conversations return after switching notes and reloading Obsidian, while additional-note selections clear on Emend plugin or Obsidian reload.

If a scenario fails, see the troubleshooting section in [INSTALLATION.md](INSTALLATION.md) and check the provider error shown in chat before retrying.
