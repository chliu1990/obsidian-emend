# Emend

[![CI](https://github.com/chliu1990/obsidian-emend/actions/workflows/ci.yaml/badge.svg)](https://github.com/chliu1990/obsidian-emend/actions/workflows/ci.yaml)

Emend is a desktop Obsidian plugin for streaming AI chat and guarded, reviewable edits to Markdown notes. Ask questions without giving the model a writer, or propose changes that remain visible as review markup. You choose the context, the workflow, and when a request is sent.

Emend supports DeepSeek, Kimi Code, and custom OpenAI-compatible providers. The separate **Track Changes** plugin reviews every edit. Emend makes no background AI requests.

## Why Emend?

- **Chat without note writes.** Ordinary Chat uses bounded note context. Explicit **Chat · Selection** sends the complete note plus a separate, complete Selection as read-only focus. Both stream answers and reasoning into the sidebar, and neither can edit a note.
- **Choose exactly what can change.** Full-note Edit can change the captured note. Selection Edit replaces only the captured range, even when you choose full-note supporting context. Empty or vanished Selections fail closed rather than widening the target.
- **Review instead of trusting a rewrite.** The model proposes closed Operations. Emend validates the complete candidate, checks note freshness, and writes CriticMarkup through a guarded path. Track Changes supplies Accept/Reject controls; Emend adds no competing diff or Apply panel.
- **Keep context explicit.** Add Related notes through visible path controls, include vault instructions, and choose per-session history. Related notes are bounded, read-only snapshots and never become edit targets.
- **Work in a compact composer.** Choose Chat or an Edit target, use Edit-only quick actions, and select a provider, model, and reasoning effort. Model choices save locally without submitting your draft or contacting a provider.
- **Research only when you opt in.** Supported DeepSeek models offer Web Review and Web Auto in Chat. Review exposes editable queries, URLs, and extraction goals. Answers can include verified evidence, citations, and visible incompleteness warnings.

## Choose a workflow

Supporting context helps the model understand a request. It does not grant write access or expand an edit target.

| Workflow | Context sent | Write permission | Review or recovery |
| --- | --- | --- | --- |
| **Chat** | Bounded active-note Markdown. Small notes can be sent whole. | **None.** Chat has no note writer. | Read the streamed answer; the note stays unchanged. |
| **Chat · Selection** | The complete note plus a separate, complete Selection as read-only focus. | **None.** Selecting text does not change this boundary. | Read the answer; no Track Changes review is needed. |
| **Edit · Full note** | The complete active note. | The complete captured note, after atomic validation and freshness checks. | Review CriticMarkup in the separate Track Changes plugin. |
| **Edit · Selection** | The complete Selection plus Default Smart or Symmetric surroundings. | **Only the captured Selection.** | Track Changes review or Obsidian's native undo. |
| **Edit · Selection · Full note** | The complete note plus a separate, complete Selection target. | **Full-note context, Selection-only write.** | Track Changes review or native undo for the exact range. |
| **Modify selected text with AI** | The complete Selection with Default or full-note context, without chat history. | **Only the captured Selection.** | A result notice, Track Changes review, or native undo. |

All Edit paths compile valid Operations into CriticMarkup. A failed candidate, stale source, or cancelled request produces no partial write. See [Editing and review](docs/guides/editing-and-review.md) for recipes and validation details.

## 2.10 highlights

- **Selection-focused conversation:** Explicit Chat Selection keeps the complete Selection intact above the ordinary context budget while remaining read-only.
- **Full-note context without a wider Selection write:** The composer and Modify Selection can share the complete note while replacing only the captured Selection.
- **More capable compact controls:** Writing/Web and model/reasoning menus preserve drafts and separate local settings changes from actual submissions.
- **Explicit Related notes:** All/Links exploration, path search, folder helpers, and manual Refresh select context without reading note bodies in advance.
- **Independent note sessions:** New, switch, rename, and delete actions keep ready messages, drafts, and provider history scoped to each session.
- **Clearer Web progression:** Provisional research text is labelled `Draft answer — research may continue`, clears before retrieval, and never replaces the terminal answer.
- **Stabilized editing and persistence:** Composed-note validation, multi-pane freshness checks, session recovery, and sanitized saved results reinforce existing write and privacy boundaries.

These are current capabilities, not a promise of automatic context compression, background discovery, or Web support for every provider. The [changelog](CHANGELOG.md) records shipped releases and the [roadmap](ROADMAP.md) separates current behavior from deferred work.

## Requirements and providers

- Desktop Obsidian **1.11.4 or newer**. Mobile is not supported.
- An API key and available model on a streaming OpenAI-compatible chat endpoint.
- The separate [Track Changes community plugin](https://github.com/philphilphil/obsidian-track-changes) to review Emend edits. Chat works without it.
- Node.js **24** and npm only when building from source.

| Provider | Preset model and base URL | Chat and Edit | Web Review / Auto |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` at `https://api.deepseek.com`; `deepseek-v4-pro` is also built in | Supported | Only with exactly `deepseek-flash` or `deepseek-v4-pro` |
| Kimi Code | `k3.1-pro` at `https://api.kimi.com/coding/v1` | Supported | Not supported |
| Custom | Your model and OpenAI-compatible base URL | Supported when the endpoint streams chat completions | Not supported |

Models and base URLs remain editable. Emend appends `/chat/completions`. **Refresh models** in Settings is the only model-discovery action; it sends an explicit authenticated `GET <base URL>/models` request. Opening chat or the model menu never discovers models automatically.

Unsupported Web combinations fail explicitly. Emend never silently turns them into ordinary unsearched Chat or switches providers. Web research is Off by default, unavailable in Edit, and has no note writer.

## Installation

**Recommended: use BRAT.** Install and enable **BRAT — Beta Reviewers Auto-update Tool**, choose **Add beta plugin**, and enter:

```text
https://github.com/chliu1990/obsidian-emend
```

BRAT installs Emend from GitHub releases; it does not install Track Changes. Alternatively, download `emend-<version>.zip` from [GitHub releases](https://github.com/chliu1990/obsidian-emend/releases) and extract it into `<Vault>/.obsidian/plugins/`. The archive contains the complete `emend/` folder.

If you will edit notes, install and enable the separate **Track Changes** plugin before enabling Emend. Then enable **Emend** under **Settings → Community plugins**. Chat alone does not require Track Changes, and Emend never installs other plugins automatically.

Follow the [installation guide](INSTALLATION.md) for ZIP, source, folder-layout, update, removal, and troubleshooting steps. Then configure a provider and complete the [Quick Start](QUICK_START.md).

## Privacy and write safety

Emend sends note content only through an explicit Chat or Edit submission. Opening chat, changing a model, selecting Related notes, loading a session, or changing Web mode makes no background AI request. Settings-only model discovery runs only when you click **Refresh models**.

Ordinary Chat uses bounded context. Chat Selection deliberately sends the complete note and complete read-only focus. Full-note Edit always sends the complete note. Selection Edit sends the complete Selection with bounded surroundings or explicit full-note support; **full-note context still means Selection-only write**. Related notes are included only after explicit selection and remain read-only.

Ready history comes only from the originating session and respects **Chat history messages**. Vault-root `AGENTS.md` and safely referenced skills can join submissions. **Include note path** is Off by default. API keys use Obsidian SecretStorage, while non-secret settings and ready chats remain in the vault.

A candidate-validation failure can cause one automatic correction request to the same provider. It includes the original request, invalid candidate, and bounded feedback. Provider, cancellation, stale-note, and write failures do not trigger that correction.

With Web Review or Auto, DeepSeek may derive retrieval arguments from note context. Review shows them before retrieval; Auto skips only that pause. Retrieval, extraction, verification, and refinement can incur separate charges. Retrieved content remains untrusted, read-only data.

See [Privacy and storage](docs/guides/privacy-and-storage.md) for request recipients, local-data lifetimes, Web sharing, and cleanup.

## Documentation

### Use Emend

- [Quick Start](QUICK_START.md) — complete a first Chat, Full-note Edit, Selection Edit, review, and undo.
- [Chat and context](docs/guides/chat-and-context.md) — Chat Selection, Related notes, sessions, models, capacity, and instructions.
- [Editing and review](docs/guides/editing-and-review.md) — Edit targets, quick actions, Modify Selection, Track Changes, and native undo.
- [Web research](docs/guides/web-research.md) — Review/Auto, provisional drafts, citations, limits, and warnings.
- [Settings reference](docs/guides/settings-reference.md) — providers, discovery, context, history, capacity, and Web limits.

### Privacy and safety

- [Privacy and storage](docs/guides/privacy-and-storage.md) — write permissions, recipients, credentials, and persistence.
- [Installation and removal](INSTALLATION.md#remove-emend) — plugin files, API keys, and saved-chat cleanup.
- [Security policy](SECURITY.md) — vulnerability reporting and security boundaries.

### Develop and verify

- [Contributing guide](CONTRIBUTING.md) — focused PRs, required checks, and review expectations.
- [Contributor and agent instructions](AGENTS.md) — architecture invariants and development conventions.
- [Implementation contract and stage index](IMPLEMENTATION_PLAN.md) — owning modules and detailed technical records.
- [2.10 stabilization record](devel_docs/51-2-10-stabilization.md) — fixes, verification evidence, and recorded limits.

### Release and roadmap

- [Changelog](CHANGELOG.md) — shipped-version history.
- [Roadmap](ROADMAP.md) — current priorities, deferred designs, and non-goals.
- [Publication and distribution](devel_docs/publication.md) — release copy, assets, and distribution decisions.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

Emend uses strict TypeScript, Vitest, and esbuild. Its desktop transport uses browser `fetch` with Server-Sent Events. See [CONTRIBUTING.md](CONTRIBUTING.md) before changing behavior, provider access, persistence, or note-writing paths.

## Attribution

Emend is based on Lapis Lazuli AI Assistant by Taha Yiğit Melek. See [CREDITS.md](CREDITS.md) and the MIT [LICENSE](LICENSE) for attribution.

Maintained by **Chang Liu and Kimi K3.1 Pro**. This project was driven by vibecoding with **Kimi K3.1 Pro** using **Kimi Code**.
