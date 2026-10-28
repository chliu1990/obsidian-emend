# Implementation Plan: Emend
## AI text correction agent for Obsidian — Agent-First, Permission-Gated, Track-Changes-Native
## Originally forked from Lapis Lazuli AI Assistant

---

## 1. Goal & Design Philosophy

Build a daily-driver Obsidian plugin that lets a user chat with an LLM (Kimi, DeepSeek, or any OpenAI-compatible provider) about the active note, with strict permission controls inspired by VS Code Kilo Code / Cursor Agent modes.

The **Track Changes** plugin (`skills/track-changes-review`, using CriticMarkup) is the *only* review surface. This plugin does NOT show its own diff — it is purely a chat interface + transport layer.

### Core Principles
- **Modes are explicit, not guessed.** The user picks a mode; the model never decides whether to edit.
- **Permissions are enforced in code, not prompts.** Non-edit modes have zero write paths.
- **The file is the source of truth.** Edits are always returned as CriticMarkup-annotated text and written to the note directly. Track Changes renders the review UI.
- **Zero vendor lock-in.** Any OpenAI-compatible endpoint works via a configurable base URL.
- **No confirmation gates.** Because Track Changes provides per-change Accept/Reject, the plugin writes edits immediately upon receiving them. The user reviews in Track Changes, not in the chat.

---

## 2. Feature Spec

### 2.1 Modes (user-selectable, deterministic)

| Mode | Icon | Can Write? | System Prompt Role | Typical Use |
|---|---|---|---|---|
| **Ask** | MessageCircle | NO | Answer questions about the note | "What does section 3 mean?" |
| **Edit** | PenLine | YES | Return CriticMarkup-annotated full note | "Proofread this paragraph" |
| **Discuss** | MessagesSquare | NO | Debate, critique, evaluate ideas | "Should I keep this argument?" |
| **Brainstorm** | Lightbulb | NO | Generate options, outlines, alternatives | "Give me 3 ways to structure this" |

**Mode selector UI:** A segmented button group in the chat composer header. Default: Ask. Mode persists per chat session (not globally).

### 2.2 Permission Model

Inspired by VS Code Kilo Code:

- **Ask / Discuss / Brainstorm:** The plugin has no function to write to the file. The model can only respond in the chat panel. This is a *code guarantee*, not a prompt instruction.
- **Edit:** The model returns the full note with CriticMarkup. The plugin writes it to the file **immediately** via `vault.modify()`. Track Changes then renders the review cards for per-change Accept/Reject. No confirmation step.
- **Modify Selection (Edit sub-mode):** When text is selected in the editor, the plugin sends only the selected text + surrounding context. The model returns the modified selection (still CriticMarkup-wrapped), which is merged back into the full note and written. Same immediate apply.

### 2.3 Provider System

| Provider | Type | Config Fields |
|---|---|---|
| DeepSeek | Built-in | API key, model name (default: `deepseek-flash`) |
| Kimi (Moonshot) | Built-in | API key, model name (default: `kimi k3.1 pro`) |
| Custom | OpenAI-compatible | Base URL, API key, model name |

All providers use the same `requestOpenAiLike` function. DeepSeek and Kimi code plan are just presets with pre-filled base URLs. Use high reasoning efforts by default, provide dropdown icons on both model and reasoning efforts 

Stream the output, including the reasoning (but fold by default). Use LaTeX equations for both inline and displayed mode, (obsidian should have its own mathjax or similar js file?)

### 2.4 Agent Instructions & Skill Discovery

1. On every request, the plugin reads `AGENTS.md` from the vault root (if it exists).
2. The plugin **parses AGENTS.md for skill references** — any path pattern like `skills/{skill-name}/` or explicit `.md` file paths mentioned in the document are extracted as skill locations.
3. For each discovered skill path, the plugin looks for `SKILL.md` at that location and loads it.
4. All loaded skill instructions are appended to the system prompt **before** AGENTS.md content, so AGENTS.md can override or refine skill behavior.
5. No manual "Extra instructions" text box in settings — it's all file-based and auto-discovered.

**Skill reference convention in AGENTS.md:**
```markdown
A tracked-changes skill is installed at `skills/track-changes-review`.
Another skill is available at `skills/my-custom-skill/SKILL.md`.
```

The parser extracts:
- Inline code spans containing `skills/` → resolves to `{path}/SKILL.md`
- Explicit markdown file paths ending in `.md` → loads directly
- Duplicate paths are deduplicated

### 2.5 Response Protocol (Plain Text, No JSON)

Because modes are explicit, we no longer need the model to classify intent or return JSON.

- **Ask/Discuss/Brainstorm:** Model returns plain Markdown text → rendered in chat.
- **Edit:** Model returns plain text (the full note, CriticMarkup-annotated) → written to file immediately → chat shows a brief confirmation (e.g., "Edit applied. 4 changes tracked.").
- **Modify Selection:** Model returns the modified selection with CriticMarkup → merged into full note → written immediately.

This eliminates:
- The `{"type":"answer"/"edit"}` JSON protocol
- The `parseChatResponse` function
- The `buildChatSystemPrompt` / `buildInlineSystemPrompt` split
- Fragility with reasoning models that add explanatory text
- Any "Apply" / "Confirm" UI buttons

---

## 3. File Structure

```
src/
  main.ts                 — Plugin entry, settings, write gating, selection edit
  chat-view.ts            — Chat UI, mode selector, message rendering
  providers.ts            — LLM API calls (OpenAI-compatible)
  settings.ts             — Plugin settings tab
  mode.ts                 — Mode enum, mode-specific system prompts
  permissions.ts          — Permission checks (canWrite)
  instructions-loader.ts  — AGENTS.md + SKILL.md loader
  types.ts                — Shared interfaces
styles.css                — Plugin styles
manifest.json             — Obsidian manifest
```

---

## 4. Detailed File Specs

### 4.1 `src/types.ts` (NEW)

```typescript
export type Mode = 'ask' | 'edit' | 'discuss' | 'brainstorm';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  mode: Mode;        // which mode this was sent in
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface PluginSettings {
  activeProvider: 'deepseek' | 'kimi' | 'custom';
  providers: {
    deepseek: ProviderConfig;
    kimi: ProviderConfig;
    custom: ProviderConfig;
  };
  defaultMode: Mode;
  maxContextCharacters: number;
  includeNotePathInContext: boolean;
}
```

### 4.2 `src/mode.ts` (NEW)

```typescript
export const MODES: { id: Mode; label: string; icon: string; canWrite: boolean }[] = [
  { id: 'ask', label: 'Ask', icon: 'message-circle', canWrite: false },
  { id: 'edit', label: 'Edit', icon: 'pen-line', canWrite: true },
  { id: 'discuss', label: 'Discuss', icon: 'messages-square', canWrite: false },
  { id: 'brainstorm', label: 'Brainstorm', icon: 'lightbulb', canWrite: false },
];

function appendSkillsAndAgent(prompt: string, skillTexts: Map<string, string>, agentInstructions?: string): string {
  if (skillTexts.size > 0) {
    prompt += '\n\n=== Loaded Skills ===';
    for (const [path, content] of skillTexts) {
      const skillName = path.split('/').slice(-2, -1)[0] || path;
      prompt += `\n\n--- Skill: ${skillName} ---\n${content.trim()}`;
    }
  }
  
  if (agentInstructions?.trim()) {
    prompt += `\n\n=== Agent Instructions ===\n${agentInstructions.trim()}`;
  }
  
  return prompt;
}

export function getSystemPrompt(
  mode: Mode,
  skillTexts: Map<string, string> = new Map(),
  agentInstructions?: string
): string {
  const basePrompts: Record<Mode, string> = {
    ask: `You are an AI assistant helping with an Obsidian note. Answer the user's question based on the note content. Be concise and accurate. Do not edit the note.`,
    
    edit: `You are an AI editor for an Obsidian note. You must return the COMPLETE note with ALL changes marked using CriticMarkup syntax:
- Insertions: {++new text++}
- Deletions: {--old text--}
- Substitutions: {~~old~>new~~}
- Comments: {>>your explanation here<<}
- Highlights: {==important text==}

Rules:
1. Return the ENTIRE note, not just the changed parts.
2. Every change must be wrapped in CriticMarkup.
3. Attach {>>comments<<} to explain significant changes.
4. Do NOT change anything without marking it.
5. Preserve YAML frontmatter, wiki links, tags, code blocks, math, callouts, footnotes.
6. Keep the note's language.`,

    discuss: `You are a critical discussion partner for an Obsidian note. Evaluate ideas, challenge assumptions, and offer perspective. Do not edit the note — discuss it in your response. Quote specific passages when relevant.`,

    brainstorm: `You are a brainstorming partner for an Obsidian note. Generate creative options, alternative structures, and new angles. Present ideas as numbered lists or outlines. Do not edit the note — only generate ideas in your response.`,
  };

  return appendSkillsAndAgent(basePrompts[mode], skillTexts, agentInstructions);
}

export function getSelectionSystemPrompt(
  skillTexts: Map<string, string> = new Map(),
  agentInstructions?: string
): string {
  let prompt = `You are an AI editor for a selected portion of an Obsidian note. You will receive the selected text and a request. Return ONLY the modified version of the selected text, with ALL changes marked using CriticMarkup syntax:
- Insertions: {++new text++}
- Deletions: {--old text--}
- Substitutions: {~~old~>new~~}
- Comments: {>>your explanation here<<}

Rules:
1. Return ONLY the selected portion, not the full note.
2. Every change must be wrapped in CriticMarkup.
3. Preserve markdown formatting within the selection.
4. Keep the note's language.`;

  return appendSkillsAndAgent(prompt, skillTexts, agentInstructions);
}
```

### 4.3 `src/permissions.ts` (NEW)

```typescript
import { Mode } from './mode';

/**
 * Code-level permission checks.
 * These are the ONLY places that determine whether a write operation is allowed.
 */

export function canWriteToNote(mode: Mode): boolean {
  return mode === 'edit';
}
```

### 4.4 `src/instructions-loader.ts` (NEW)

```typescript
import { TFile, Vault } from 'obsidian';

const AGENTS_PATH = 'AGENTS.md';
const SKILL_MD = 'SKILL.md';

export interface LoadedInstructions {
  agentText: string | undefined;
  skillTexts: Map<string, string>; // path -> content
}

export async function loadAllInstructions(vault: Vault): Promise<LoadedInstructions> {
  const agentText = await loadMarkdownFile(vault, AGENTS_PATH);
  const skillPaths = agentText ? extractSkillPaths(agentText) : [];
  
  const skillTexts = new Map<string, string>();
  for (const path of skillPaths) {
    const content = await loadMarkdownFile(vault, path);
    if (content) skillTexts.set(path, content);
  }
  
  return { agentText, skillTexts };
}

/** Parse AGENTS.md for skill references.
 *  Matches:
 *  - `skills/anything/here` → resolves to skills/anything/here/SKILL.md
 *  - `skills/anything/SKILL.md` → loads directly
 *  - Any .md file path containing "skill" or "SKILL.md"
 */
export function extractSkillPaths(agentText: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  
  // Pattern 1: inline code spans with skills/ prefix
  const codeSpanPattern = /`([^`]*skills\/[^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = codeSpanPattern.exec(agentText)) !== null) {
    let path = match[1].trim();
    // If it doesn't end with .md, assume it's a directory and append SKILL.md
    if (!path.endsWith('.md')) {
      path = path.replace(/\/$/, '') + '/' + SKILL_MD;
    }
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  
  // Pattern 2: explicit file paths ending in SKILL.md or skill.md
  const filePathPattern = /(?:`|\(|\[|\s)([^\s)`\]]*(?:SKILL|skill)\.md)/g;
  while ((match = filePathPattern.exec(agentText)) !== null) {
    const path = match[1].trim();
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  
  return paths;
}

async function loadMarkdownFile(vault: Vault, path: string): Promise<string | undefined> {
  const file = vault.getAbstractFileByPath(path);
  if (file instanceof TFile && file.extension === 'md') {
    return vault.cachedRead(file);
  }
  return undefined;
}
```

### 4.5 `src/providers.ts` (MODIFY — simplify)

**Remove:**
- `AiChatResponse` union type
- `parseChatResponse`
- `buildChatSystemPrompt` / `buildInlineSystemPrompt`
- `requestAiChatResponse` / `requestAiSuggestion` split
- Provider-specific request functions for Gemini/Claude (keep only OpenAI-compatible)
- JSON classification logic

**Keep / Simplify:**

```typescript
export async function requestAiResponse(
  settings: PluginSettings,
  context: {
    markdown: string;
    notePath?: string;
    userMessage: string;
    systemPrompt: string;
  },
  history: AiMessage[] = [],
): Promise<string> {
  const provider = getActiveProviderConfig(settings);
  
  const messages = [
    { role: 'system', content: context.systemPrompt },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: buildUserPrompt(context) },
  ];

  const response = await fetch(provider.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function buildUserPrompt(context: { markdown: string; notePath?: string; userMessage: string }): string {
  const parts: string[] = [];
  if (context.notePath) parts.push(`Note path: ${context.notePath}`);
  parts.push(`\nNote content:\n\`\`\`markdown\n${context.markdown}\n\`\`\``);
  parts.push(`\nUser request:\n${context.userMessage}`);
  return parts.join('\n');
}

function buildSelectionUserPrompt(context: { selectedText: string; surroundingContext: string; userMessage: string }): string {
  return [
    `Surrounding context:\n\`\`\`markdown\n${context.surroundingContext}\n\`\`\``,
    `\nSelected text to modify:\n\`\`\`markdown\n${context.selectedText}\n\`\`\``,
    `\nUser request:\n${context.userMessage}`,
  ].join('\n');
}
```

### 4.6 `src/chat-view.ts` (MODIFY — add mode selector, remove Apply button)

**UI Changes:**

1. **Mode selector** above the textarea:
   ```
   [Ask] [Edit] [Discuss] [Brainstorm]
   ```
   - Segmented button group, styled like Obsidian's toggle tabs
   - Active mode highlighted
   - Clicking switches mode
   - Mode is stored in `this.currentMode`

2. **Composer textarea placeholder** changes per mode:
   - Ask: "Ask a question about this note..."
   - Edit: "Describe the changes you want..."
   - Discuss: "Share your thoughts or concerns..."
   - Brainstorm: "What do you want ideas for?"

3. **Message rendering:**
   - Each chat message shows a small badge indicating which mode it was sent in
   - Edit-mode assistant messages show a brief confirmation line: "✓ Edit applied — review in Track Changes panel."
   - **NO "Apply to Note" button.** The edit is already in the file.

4. **Remove:**
   - `kind: 'answer' | 'edit'` from message type
   - `response.type` branching in `submitPrompt`
   - Any apply/reject UI elements

**State:**
```typescript
private currentMode: Mode = this.plugin.settings.defaultMode;
```

**Submit flow:**
```typescript
private async submitPrompt() {
  const prompt = this.inputEl?.value.trim();
  if (!prompt || this.isSending) return;

  const mode = this.currentMode;
  const { agentText, skillTexts } = await this.plugin.loadAllInstructions();
  const systemPrompt = getSystemPrompt(mode, skillTexts, agentText);

  // Push user message
  this.messages.push({ role: 'user', content: prompt, mode });
  this.isSending = true;
  this.render();

  try {
    const response = await this.plugin.requestAiResponse(prompt, systemPrompt);

    // If Edit mode, write to file immediately
    if (mode === 'edit') {
      await this.plugin.applyEditToNote(response);
    }

    // Push assistant message
    this.messages.push({ role: 'assistant', content: response, mode });
  } catch (error) {
    this.messages.push({
      role: 'assistant',
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      mode,
    });
  } finally {
    this.isSending = false;
    this.render();
  }
}
```

### 4.7 `src/main.ts` (MODIFY — write gating, remove diff, add selection edit)

**Remove:**
- `showDocumentDiffPreview` and all `DocumentDiffPreview` logic
- `buildLineDiff` usage
- `acceptDocumentDiffPreview` / `rejectDocumentDiffPreview` / `acceptDocumentDiffHunk` / `rejectDocumentDiffHunk`
- `getContextWindow` can be simplified
- The `lastMarkdownView` fallback logic (only use active view)
- `generateInlineSuggestion` command and all inline suggestion logic

**Add:**

```typescript
export default class EmendPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(EMEND_CHAT_VIEW, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon('messages-square', 'Open Emend chat', () => this.activateChatView());
    this.addCommand({ id: 'emend:open-chat', name: 'Open Emend chat', callback: () => this.activateChatView() });

    // Modify Selected Text command (Edit mode, selection required)
    this.addCommand({
      id: 'emend:modify-selected-text',
      name: 'Emend: Modify selected text',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!(ctx instanceof MarkdownView)) return false;
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) return false;
        if (!checking) void this.modifySelectedText(editor, ctx);
        return true;
      },
    });

    this.addSettingTab(new SettingTab(this.app, this));
  }

  /** Write annotated markdown to the active note. Called only from Edit mode. */
  async applyEditToNote(annotatedMarkdown: string): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('No active note to apply edits to.');
      throw new Error('No active note');
    }
    const file = view.file;
    if (!file) throw new Error('No file');

    await this.app.vault.modify(file, annotatedMarkdown);
    new Notice('Edit applied. Review changes in Track Changes.');
  }

  /** Modify only the selected text. Replaces selection with annotated version. */
  async modifySelectedText(editor: Editor, view: MarkdownView): Promise<void> {
    const selectedText = editor.getSelection();
    if (!selectedText?.trim()) {
      new Notice('Select some text first.');
      return;
    }

    const fullNote = editor.getValue();
    const from = editor.posToOffset(editor.getCursor('from'));
    const to = editor.posToOffset(editor.getCursor('to'));

    // Get surrounding context (before + after)
    const contextWindow = getContextWindow(fullNote, from, to, this.settings.maxContextCharacters);

    const { agentText, skillTexts } = await this.loadAllInstructions();
    const systemPrompt = getSelectionSystemPrompt(skillTexts, agentText);

    const userPrompt = `Modify the following selected text based on this request: ${''}`; // populated from a quick prompt modal or clipboard

    // For simplicity: open a small modal asking "How do you want to modify this?"
    // Or reuse the chat panel: auto-populate the input with the selection context
    // Implementation detail: send selection to chat, pre-fill user message

    // After receiving response:
    // editor.replaceSelection(annotatedSelection);
    // This writes directly (selection replacement is immediate and reversible via Track Changes)
  }

  async requestAiResponse(userMessage: string, systemPrompt: string): Promise<string> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) throw new Error('Open a Markdown note first.');

    const editor = view.editor;
    const context = await this.buildContext(editor, view, userMessage);
    return requestAiResponse(this.settings, { ...context, systemPrompt }, this.getHistory());
  }

  async loadAllInstructions(): Promise<LoadedInstructions> {
    return loadAllInstructions(this.app.vault);
  }
}
```

**Command registration:**
- `Modify selected text with AI`: available whenever text is selected in a Markdown editor. Opens a quick input modal (or uses the chat panel) to ask what modification to make, then replaces the selection with the AI's annotated output.

### 4.8 `src/settings.ts` (MODIFY)

**Remove:**
- `agentInstructionsFilePath` setting (now hardcoded to `AGENTS.md`)
- Provider-specific URL hardcoding (except presets)

**Add:**

```typescript
export interface PluginSettings {
  activeProvider: 'deepseek' | 'kimi' | 'custom';
  providers: {
    deepseek: { apiKey: string; model: string };
    kimi: { apiKey: string; model: string };
    custom: { baseUrl: string; apiKey: string; model: string };
  };
  defaultMode: Mode;
  maxContextCharacters: number;
  includeNotePathInContext: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  activeProvider: 'deepseek',
  providers: {
    deepseek: { apiKey: '', model: 'deepseek-chat' },
    kimi: { apiKey: '', model: 'kimi-k2-turbo-preview' },
    custom: { baseUrl: '', apiKey: '', model: '' },
  },
  defaultMode: 'ask',
  maxContextCharacters: 8000,
  includeNotePathInContext: true,
};
```

**Settings UI:**
- Provider selector (dropdown: DeepSeek / Kimi / Custom)
- Per-provider collapsible sections with API key and model fields
- Custom provider also shows Base URL field
- Default mode selector (dropdown)
- Max context characters (number input)
- Include note path toggle

### 4.9 `styles.css` (MODIFY)

Add styles for:
- Mode selector segmented buttons
- Mode badge on messages (small pill, color-coded)
- Edit confirmation line (subtle green text below edit responses)
- Chat message layout tweaks

---

## 5. Data Flow

### 5.1 Ask / Discuss / Brainstorm Flow

```
User selects mode (Ask) → types message → clicks Send
  → Plugin reads AGENTS.md from vault root
  → Plugin parses AGENTS.md for skill references (e.g., `skills/track-changes-review`)
  → Plugin loads all referenced SKILL.md files
  → Builds system prompt: base mode prompt + all skill texts + AGENTS.md content
  → Calls LLM with note context + user message
  → LLM returns plain text answer
  → Plugin renders in chat panel
  → File is untouched (canWrite = false, no write function called)
```

### 5.2 Edit Flow (Full Note)

```
User selects mode (Edit) → types message → clicks Send
  → Plugin reads AGENTS.md + discovers all referenced skills
  → Loads all referenced SKILL.md files dynamically
  → Builds system prompt for Edit mode (includes CriticMarkup rules from skills)
  → Calls LLM with full note context + user message
  → LLM returns full note with CriticMarkup annotations
  → Plugin calls vault.modify() to write annotated text to file IMMEDIATELY
  → Chat shows: "✓ Edit applied — review in Track Changes panel."
  → Track Changes plugin detects CriticMarkup → renders review cards
  → User reviews per-change Accept/Reject in Track Changes panel
```

### 5.3 Modify Selected Text Flow

```
User selects text in editor → runs "Modify selected text with AI" command
  → Plugin captures selection + surrounding context
  → Plugin reads AGENTS.md + discovers all referenced skills
  → Builds selection-specific system prompt (CriticMarkup rules from skills)
  → Prompts user: "How do you want to modify this?" (modal or chat input)
  → Calls LLM with selection + context + user request
  → LLM returns modified selection with CriticMarkup annotations
  → Plugin replaces the selection in the editor via editor.replaceSelection()
  → Track Changes renders the annotated selection changes
```

**Note:** `editor.replaceSelection()` is used for Modify Selection instead of `vault.modify()`. The change is still written to the file (Obsidian saves editor changes), but it's a surgical replacement rather than a full-file overwrite. Track Changes will still pick up the CriticMarkup.

---

## 6. Error Handling

| Error | Message | Action |
|---|---|---|
| No active note | "Open a Markdown note first." | Abort request |
| No API key configured | "Please configure your API key in settings." | Abort request |
| LLM returns empty | "The AI returned an empty response." | Show error in chat |
| LLM API error | Show provider error message | Show error in chat |
| AGENTS.md not found | (silent) | Proceed without agent instructions or skills |
| Referenced skill not found | (silent) | Skip that skill, load others |
| No skills referenced in AGENTS.md | (silent) | Proceed with agent instructions only |
| No text selected for Modify Selection | "Select some text first." | Abort |

---

## 7. Settings Migration (from Lapis Lazuli)

If a user upgrades from Lapis Lazuli:
- Read existing `this.loadData()` and map:
  - `activeProvider` → keep
  - `apiKeys[provider]` → `providers[provider].apiKey`
  - `models[provider]` → `providers[provider].model`
  - `maxContextCharacters` → keep
  - `includeNotePathInContext` → keep
  - `agentInstructionsFilePath` → IGNORE (now hardcoded)
- Delete old `document-diff-preview` and `inline-suggestions` state if any

---

## 8. Testing Checklist

### 8.1 Mode Behavior
- [ ] Ask mode: chat response only, file unchanged
- [ ] Discuss mode: chat response only, file unchanged
- [ ] Brainstorm mode: chat response only, file unchanged
- [ ] Edit mode: file modified immediately upon response, chat shows confirmation
- [ ] Mode persists when switching notes

### 8.2 Provider System
- [ ] DeepSeek works with correct base URL
- [ ] Kimi works with correct base URL (`https://api.moonshot.cn/v1`)
- [ ] Custom provider accepts any base URL
- [ ] Switching provider updates active model label

### 8.3 Edit Flow
- [ ] Edit response contains CriticMarkup annotations
- [ ] File is written immediately (no Apply button)
- [ ] Track Changes renders the annotations after edit
- [ ] Multiple sequential edits stack correctly in Track Changes

### 8.4 Modify Selected Text
- [ ] Command available only when text is selected
- [ ] Selection is sent with surrounding context
- [ ] Response replaces only the selected text
- [ ] CriticMarkup in selection is rendered by Track Changes
- [ ] Undo works via Obsidian's native undo

### 8.5 Instructions & Skill Discovery
- [ ] AGENTS.md changes are picked up on next request (no restart)
- [ ] Skill references in AGENTS.md are auto-discovered (`skills/xxx/` syntax)
- [ ] Multiple skills referenced in AGENTS.md are all loaded
- [ ] Explicit `.md` file paths in AGENTS.md are loaded as skills
- [ ] Duplicate skill references are deduplicated
- [ ] Missing skill files are skipped silently, others still load
- [ ] AGENTS.md content overrides skill instructions when conflicting

### 8.6 Edge Cases
- [ ] Very long notes (truncated context window)
- [ ] Empty note
- [ ] Note with complex frontmatter
- [ ] Note with code blocks (preserved in edits)
- [ ] Network failure mid-request
- [ ] LLM returns non-CriticMarkup in Edit mode (still applied, Track Changes shows nothing — acceptable)
- [ ] Modify Selection with multi-line selected text

---

## 9. Naming & Branding

Plugin name: **Emend**

Internal identifiers:
- Plugin ID: `emend`
- Class name: `EmendPlugin`
- View type: `EMEND_CHAT_VIEW`
- Command prefix: `emend:`
- CSS prefix: `emend-`

**Attribution:** Originally based on [Lapis Lazuli AI Assistant](https://github.com/tahayigitmelek/lapis-lazuli-ai-assistant) by Taha Yiğit Melek. This fork has been heavily modified to support agent modes, CriticMarkup-native editing, and dynamic skill loading. Keep the original LICENSE file and a `CREDITS.md` acknowledging the lineage.

---

## 10. License Check

Before publishing:
- Verify the original Lapis Lazuli repo has a permissive LICENSE file
- If missing, open an issue on the original repo requesting a license
- Include original copyright notice in fork if required by license

---

## 11. Future Enhancements (Post-MVP)

1. **Conversation persistence:** Save chat threads per note in `.obsidian/emend/chats/{note-path}.json`
2. **Multi-turn Edit:** After applying an edit, the next Edit request uses the updated note as context
3. **Quick actions:** Buttons above the composer for common tasks ("Fix grammar", "Make concise", "Add examples")
4. **Keyboard shortcuts:** Cmd+Enter to send, Cmd+Shift+A to switch to Ask, Cmd+Shift+E to switch to Edit
5. **Token usage display:** Show estimated tokens used per request
6. **Smart selection context:** Auto-expand selection to include full sentence/paragraph for better context

---

*End of Implementation Plan*
