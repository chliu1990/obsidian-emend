# Deferred feature backlog: provider and context improvements

Checked items are implemented current behavior. Unchecked items are approved future feature requests, not current Emend behavior. Implement each remaining item as a separate reviewed change with unit tests, real-Obsidian verification, documentation, and CI evidence.

## 1. Provider model-list discovery

- [x] Add an explicit **Refresh models** action in provider settings that requests the available model list from the configured provider.
- [x] Request the configured provider's OpenAI-compatible `GET /models` endpoint. Custom endpoints that do not support discovery produce a clear error while manual model entry remains available.
- [x] Populate the model dropdown from returned IDs while preserving editable custom model entry and valid persisted overrides.
- [x] Use returned display names when available, falling back to the model ID without inventing missing metadata.
- [ ] Use context-window, output-limit, supported-modality, reasoning-effort, and API-capability metadata deliberately. This capability metadata remains deferred; do not invent missing metadata.
- [x] Resolve credentials only through SecretStorage. Never print keys or include them in logs/errors.
- [x] Send discovery only after an explicit user action—never on plugin load, settings open, note open, or a periodic schedule.
- [x] Cache only non-secret model IDs/display names and invalidate the relevant provider's cache when its base URL or API key changes. Switching the active provider does not trigger discovery or modify another provider's cache; failed discovery preserves the previous valid cache.
- [x] Test response validation, malformed/empty lists, duplicates, unsupported providers, HTTP errors, cache invalidation, no background requests, and custom-model preservation.

## 2. Vision models and embedded note content

- [ ] Allow a model with declared vision support to receive images embedded in the active note through forms such as `![[image.png]]` and standard Markdown image links.
- [ ] Resolve only vault-local attachments explicitly referenced by the note. Do not read arbitrary filesystem paths, remote URLs, or unreferenced vault attachments.
- [ ] Add provider/model capability checks and an obvious per-request indicator showing which attachments will be sent. Vision must be off or unavailable for text-only models rather than silently dropping images.
- [ ] Convert supported images to the provider’s declared multimodal message format while retaining streamed text/reasoning behavior. Keep provider-specific payload parsers separate.
- [ ] Enforce configurable count, byte-size, dimension, and MIME-type limits before reading or uploading. Reject unsupported/corrupt files without sending a partial hidden payload.
- [ ] Disclose that image content leaves the vault and may be processed by the selected provider. No background attachment upload or vault-wide image scan is allowed.
- [ ] Start with common image formats. Treat PDFs, audio, video, and other embedded file types as separate provider-specific follow-ups rather than pretending every attachment is an image.
- [ ] Test wikilink/Markdown resolution, missing files, duplicate references, unsupported models/types, size limits, binary payload encoding, streamed responses, aborts, and privacy behavior.

## 3. Include other notes in request context

- [ ] Add a note picker that lets the user explicitly include additional vault notes in a chat or selection request.
- [ ] Show included note paths and provide remove/clear controls. Preserve the selection per chat session without globally sharing it across notes unless the user chooses that behavior.
- [ ] Keep the active note as the edit target. Included notes are read-only context and must never gain a write path.
- [ ] Deduplicate the active note and repeated selections. Do not automatically include backlinks, outgoing links, tags, or entire folders.
- [ ] Bound each included note and the combined context using the current context rules, with clear omission markers. Never claim the provider saw omitted content.
- [ ] Label each included note separately in the assembled prompt and preserve frontmatter, links, code blocks, and math. Future token-accounting work must show included-note cost separately.
- [ ] Disclose included paths/content before submission and send them only after the explicit request. Note-path inclusion settings must also apply consistently to these notes.
- [ ] Handle renamed/deleted/missing notes, stale captures, large files, duplicate references, and switching the active note without leaking context into another conversation.
- [ ] Test selection/deduplication, prompt boundaries, size limits, missing/renamed notes, no-write guarantees, privacy, reload behavior, and interaction with context compression when that roadmap item is implemented.

## Delivery constraints

- Keep these features separate from the deferred context-compression and online-search implementations, while defining their interfaces so those systems can consume them later.
- Do not add background network requests, hidden vault scans, automatic uploads, or new write permissions for context notes.
- Update current documentation only when each feature is actually implemented and verified.
