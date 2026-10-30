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
- Model: an available DeepSeek model; replace the preset if your account uses a different name

### Kimi

- Base URL: `https://api.moonshot.cn/v1`
- API key: your Moonshot/Kimi key
- Model: an available Kimi model; replace the preset if needed

### Custom OpenAI-compatible provider

- Base URL: the provider's OpenAI-compatible root, such as `http://localhost:11434/v1`
- API key: the provider key, or a dummy value if your local server only requires a nonempty key
- Model: a model available on that server

Emend appends `/chat/completions` to the base URL. The provider must support streaming. Reasoning effort defaults to **High**; choose another level if the model does not support it. **Request token usage** is enabled for DeepSeek/Kimi and disabled for custom providers. Disable it if your provider rejects `stream_options`.

API keys are stored locally in Obsidian plugin data. Do not use a real key in screenshots or shared test files.

## 3. Test read-only chat

1. Open the test note.
2. Select the Emend ribbon icon or run **Open Emend chat** from the Command Palette.
3. Select **Ask** and send:

   ```text
   What is the main topic of this note? Reply with one sentence and show $x^2$ as inline math.
   ```

4. Confirm that the answer streams into chat, reasoning is folded when present, and the note does not change.
5. Try **Discuss** and **Brainstorm**. These modes also leave the note unchanged.

Useful controls:

- **Enter** or **Cmd+Enter** sends on macOS; **Ctrl+Enter** sends on Windows/Linux.
- **Shift+Enter** inserts a newline.
- **Cmd+Shift+A/E** on macOS or **Ctrl+Shift+A/E** on Windows/Linux selects Ask/Edit without sending.
- **Stop** aborts an in-flight request. **Copy** copies a completed answer.

## 4. Test a full-note edit

1. Keep **Edit strategy** set to **Critic markup** in Emend settings.
2. Select **Edit** in chat and send:

   ```text
   Correct the grammar mistake and add one short third idea. Mark every change with CriticMarkup.
   ```

3. Confirm that chat shows an edit confirmation rather than the full rewritten note.
4. Open the Track Changes review surface. You should see the correction and insertion as reviewable changes.
5. Accept or reject the changes in Track Changes. Emend itself has no Apply/Reject buttons.

For quick actions, select **Fix grammar**, **Make concise**, or **Add examples** above the composer. Each switches to Edit and submits one visible request through the same guarded path.

## 5. Test selection-only editing

1. Select only `This sentence have a small grammar problem.`
2. Run **Modify selected text with AI** from the Command Palette.
3. Enter:

   ```text
   Correct the grammar without changing the meaning.
   ```

4. Select **Modify selection**.
5. Confirm that only the selected sentence receives CriticMarkup. The heading and idea list must remain unchanged.
6. Review it in Track Changes, or press **Cmd+Z** on macOS (**Ctrl+Z** on Windows/Linux) to undo the editor replacement.

**Smart selection context** is enabled by default. Emend can send the containing paragraph for context, but it never expands the replacement target.

## 6. Try operation-based editing

After the CriticMarkup test succeeds, open **Settings → Emend → Edit strategy** and select **Operations**. Repeat a small edit.

In this mode, Emend asks the model for a closed JSON array of `insert`, `remove`, `replace`, and `comment` commands. Emend validates exact anchors and occurrences, rejects ambiguous or overlapping commands, compiles valid commands into CriticMarkup, and uses the same Track Changes review path. Keep the default **Critic markup** strategy if you do not want to test this protocol.

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

- Ask different questions in two notes, switch between them, and reload Obsidian. Each note should restore its own conversation.
- Saved chats are under `<Vault>/.obsidian/emend/chats/`. They contain ready chat messages, not API keys or buffered full-note edit responses.
- Enable **Include note path** only if you want the vault/note path sent to the provider.
- Full-note Edit always sends the complete note. Read-only modes send bounded context; selection editing sends the complete selection plus surrounding context.
- Deleting a note does not delete its saved conversation automatically.

## Verification checklist

You have completed the quick start when:

- Ask, Discuss, and Brainstorm stream answers without changing the note.
- Edit writes reviewable CriticMarkup, not an in-plugin diff.
- Track Changes can accept or reject the edit.
- Modify Selection changes only the captured selection and native undo works.
- Conversations return after switching notes and reloading Obsidian.

If a scenario fails, see the troubleshooting section in [INSTALLATION.md](INSTALLATION.md) and check the provider error shown in chat before retrying.
