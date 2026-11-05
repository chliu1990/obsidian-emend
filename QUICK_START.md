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

The editable presets above are DeepSeek `deepseek-flash` and Kimi `k3.1-pro`. Operations is the only editing protocol; there is no CriticMarkup strategy selector. Context-cost bars/automatic compression and online search are deferred, not current features; see the [context-management roadmap](devel_docs/future-context-management.md) and [web-search roadmap](devel_docs/future-web-search.md).

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

## 4. Test a full-note edit

1. Select **Edit** in chat and send:

   ```text
   Correct the grammar mistake and add one short third idea.
   ```

2. Confirm that chat shows an edit confirmation rather than the full rewritten note.
3. Open the Track Changes review surface. You should see the correction and insertion as reviewable changes.
4. Accept or reject the changes in Track Changes. Emend itself has no Apply/Reject buttons.

For quick actions, select **Fix grammar**, **Make concise**, or **Add examples** above the composer. Each switches to Edit and submits one visible request through the same guarded path.

## 5. Test selection-only editing

1. Select only `This sentence have a small grammar problem.`
2. Run **Modify selected text with AI** from the Command Palette.
3. Enter:

   ```text
   Correct the grammar without changing the meaning.
   ```

4. Select **Modify selection**, or use **Fix grammar**, **Make concise**, or **Add examples** in the modal to submit a shared quick-action prompt without typing.
5. Confirm that only the selected sentence receives CriticMarkup. The heading and idea list must remain unchanged.
6. Review it in Track Changes, or press **Cmd+Z** on macOS (**Ctrl+Z** on Windows/Linux) to undo the editor replacement.

**Smart selection context** is enabled by default. Emend can send the containing paragraph for context, but it never expands the replacement target.

## 6. Understand operation-based editing

Every full-note and selection edit asks the model for a closed JSON array of `insert`, `remove`, `replace`, and `comment` commands. Emend validates exact anchors and occurrences, rejects ambiguous or overlapping commands, compiles valid commands into CriticMarkup, and uses the same Track Changes review path. Operations are the only model-facing edit protocol; there is no edit-strategy setting.

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
- Saved chats are under `<Vault>/.obsidian/emend/chats/`. They contain ready chat messages, not API keys, additional-note selections/snapshots, or buffered full-note edit responses.
- Additional-note paths are always shown locally in the picker controls so you can review what is selected. With **Include note path** off, provider prompts use only generic labels such as `Additional note 1`; with it on, each section includes `Path: <vault>/<note path>`. Selected content is sent with either setting when you explicitly submit.
- Enable **Include note path** only if you want the vault/note path sent to the provider for both active and additional notes.
- Full-note Edit always sends the complete active note. Read-only modes send bounded active-note context; selection editing sends the complete selection plus surrounding context. All three can include separate bounded, read-only additional-note snapshots, but Operations can target only the captured active note or selection.
- Deleting a note does not delete its saved conversation automatically.

## Verification checklist

You have completed the quick start when:

- Ask, Discuss, and Brainstorm stream answers without changing the note.
- Edit writes reviewable CriticMarkup, not an in-plugin diff.
- Track Changes can accept or reject the edit.
- Modify Selection changes only the captured selection and native undo works.
- Explicitly selected additional notes appear with their paths, remain read-only, respect context/path limits, and never leak between target notes.
- Conversations return after switching notes and reloading Obsidian, while additional-note selections clear on Emend plugin or Obsidian reload.

If a scenario fails, see the troubleshooting section in [INSTALLATION.md](INSTALLATION.md) and check the provider error shown in chat before retrying.
