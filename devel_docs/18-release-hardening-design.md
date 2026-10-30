# Emend release-hardening design

## Goal

Finish the current PR with correctness, provider, security, and usability improvements while keeping large context-management and online-search features out of the first public release.

## Current-PR scope

### Stage 18: Chat presentation and streaming

- Rename the view and command presentation from AI chat to Emend/Open Emend chat.
- Display loading content immediately as plain text. Render Markdown only after the response is ready or stopped, avoiding asynchronous Markdown-render queues that hold visible output until completion.
- Preserve folded reasoning, final Markdown/math rendering, Stop, persistence, and usage footers.
- Add explicit non-active and active hover rules with readable text colors using Obsidian variables.
- Verify with a delayed MarkdownRenderer unit regression and a real timed SSE stream in Obsidian, sampling intermediate UI states.

### Stage 19: Provider presets and publication metadata

- DeepSeek default model: `deepseek-flash`.
- DeepSeek base URL remains `https://api.deepseek.com`.
- Kimi default model: `k3.1-pro`.
- Kimi Code base URL: `https://api.kimi.com/coding/v1`.
- Preserve editable provider URLs/models and reasoning controls.
- Change manifest author to `Chang Liu and Kimi K3.1 Pro`, use an appropriate project/maintainer URL, and add matching package metadata. Preserve original copyright and CREDITS attribution.
- Sources:
  - DeepSeek model details: https://api-docs.deepseek.com/quick_start/pricing
  - DeepSeek model metadata API: https://api-docs.deepseek.com/api/list-models
  - Kimi Code API/models: https://www.kimi.com/code/docs/en/
  - Kimi Code third-party configuration: https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html

### Stage 20: Operations-only editing and selection quick actions

- Remove the user-facing CriticMarkup strategy and its setting. Operations is the only model-facing edit protocol.
- Retain the internal CriticMarkup parser, validator, and compiler output because Track Changes remains the review surface.
- Delete the CriticMarkup-specific strategy prompts and settings migration fields. Normalize older settings safely to Operations without adding a compatibility strategy path.
- Reuse the existing Fix grammar, Make concise, and Add examples definitions inside the selection modal. Each action submits one selection request through the existing guarded path and disables while pending.
- Preserve exact anchors, occurrence disambiguation, stale/abort/unload guards, native undo, and concise edit results.

### Stage 21: SecretStorage API keys

- Store provider API keys through `app.secretStorage` using IDs `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom`.
- On load, migrate any plaintext provider keys from plugin data into SecretStorage, clear them from the settings object, and persist a sanitized object.
- On every save, serialize a sanitized clone with all provider `apiKey` fields empty; never rely on callers to sanitize.
- Resolve request keys from SecretStorage. Preserve in-memory request behavior and masked settings inputs. Updating a key writes SecretStorage and saves sanitized settings.
- Do not store secrets in logs, tests, notices, stage records, or persisted conversations. Missing keys retain the existing validation error.
- Test initial migration, subsequent saves, reload resolution, per-provider independence, empty keys, and plaintext scrubbing. Perform a real Obsidian migration/reload check with dummy values.

### Stage 22: Deferred roadmap and release verification

Create `devel_docs/future-context-management.md` covering:

- Per-provider model context-window and output-reserve settings.
- Honest estimated versus provider-reported token accounting.
- A context-cost progress bar separating system/instructions, note/history/user input, and output.
- Automatic context compression at a configurable threshold, default 75%, with explicit privacy/cost behavior and no silent full-note truncation.
- Full-note edits must fail safely when complete source cannot fit; Modify Selection remains the fallback.

Create `devel_docs/future-web-search.md` covering:

- Provider-specific search/tool capabilities and capability detection.
- Explicit opt-in, provider error handling, citations, privacy, and tests.
- No automatic background searches or assumption that one provider’s tool schema works for all providers.

Update README/installation/quick-start/current architecture docs for Operations-only editing, new presets, SecretStorage, and presentation changes. Run clean install, full unit/lint/build gates, real Obsidian checks, and final review. Do not implement the deferred features in this PR.

## Delivery constraints

- Each stage has a numbered development record with Goal, Plan, Implementation details, and Verification results.
- Each stage follows red/green testing where behavior changes, a focused commit, task review, push, and successful Gitea CI on `emend-macos-docker`.
- Dependent stages execute sequentially through fresh implementation and review subagents.
- Do not merge or publish until the user separately chooses that action.
