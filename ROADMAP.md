# Emend roadmap

Emend aims to be the most predictable and privacy-conscious way to chat with and edit Obsidian notes—not the plugin with the most AI features. Safe Operations-based editing, explicit user actions, local data control, and reliable provider behavior come before feature count.

Features have no fixed deadlines. Each independently reviewable behavior gets its own focused PR, and feature PRs remain separate from release PRs.

## Now

- Maintain Emend 2.0.0 with bug fixes, security updates, documentation, and provider compatibility.
- Provider model-list discovery through an explicit **Refresh models** action. No background discovery requests.

## Next

1. **Additional notes as context:** user-selected, read-only notes with deduplication and clear privacy display.
2. **Vision inputs:** embedded vault images with strict provider, file-type, size, and capability checks, starting with one provider/model family.
3. **Context accounting:** per-provider capacity/output reserve and labelled category estimates, without compression.
4. **Automatic context compression:** separate, default-off behavior using the accounting work, with explicit privacy/cost disclosure and safe edit fallbacks.

## Later

- **Online search:** one provider-specific adapter with opt-in controls and verifiable citations. Other providers require their own implementations and reviews.
- Additional multimodal file types and provider-specific capabilities.
- Broader community and contributor workflows when maintenance capacity allows.

## Non-goals

- Autonomous or scheduled background AI requests.
- Hidden telemetry, vault scans, uploads, or context sharing.
- A universal provider schema for search, vision, or other advanced capabilities.
- Large PRs that bundle unrelated features.
- Community Directory submission at this time.

## Detailed designs

- [Context management](devel_docs/future-context-management.md)
- [Web search](devel_docs/future-web-search.md)
- [Provider and context improvements](devel_docs/future-provider-and-context-features.md)
- [Publication and distribution](devel_docs/publication.md)

These designs guide future work but do not commit the project to every feature. See [CHANGELOG.md](CHANGELOG.md) for shipped behavior and [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process.
