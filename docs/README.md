# Emend documentation

Choose the path that matches what you need to do. The focused guides contain the detailed recipes; this page only routes you to them.

## Prospective users

1. Evaluate the workflows and provider support in the [project README](../README.md).
2. Check [requirements and installation](../INSTALLATION.md).
3. Review [write permissions, request recipients, and local data](guides/privacy-and-storage.md).

## New users

1. [Install Emend and prepare edit review](../INSTALLATION.md).
2. Complete the [Quick Start](../QUICK_START.md).
3. Keep [Editing and review](guides/editing-and-review.md) nearby for Edit targets, Track Changes, and native undo.

## Everyday workflows

| Task | Guide |
| --- | --- |
| Ask about a note, focus a Selection, add Related notes, or manage sessions | [Chat and context](guides/chat-and-context.md) |
| Edit a note or Selection, use quick actions, review changes, or undo | [Editing and review](guides/editing-and-review.md) |
| Configure providers, models, history, context, capacity, or Web limits | [Settings reference](guides/settings-reference.md) |
| Review or run DeepSeek retrieval and interpret drafts, citations, or warnings | [Web research](guides/web-research.md) |

## Privacy and safety

- Start with [Privacy and storage](guides/privacy-and-storage.md).
- Use [removal and cleanup](../INSTALLATION.md#remove-emend) for plugin settings, API keys, and saved chats.
- Report vulnerabilities through the [security policy](../SECURITY.md).

## Contributors

1. Set up Node.js 24, clone the repository, and run a first build with [Build from source](../INSTALLATION.md#build-from-source).
2. Read [Contributing](../CONTRIBUTING.md), open or reference an issue, and create a focused branch from main.
3. Use [AGENTS.md](../AGENTS.md) and the [implementation contract](../IMPLEMENTATION_PLAN.md) to identify the owning module and safety invariants before changing behavior.
4. Run the [required checks](../CONTRIBUTING.md#required-checks) and open a focused PR with the requested test, privacy, storage, and write-path evidence.

## Release maintainers

- Check shipped history in the [changelog](../CHANGELOG.md) and priorities in the [roadmap](../ROADMAP.md).
- Use [publication and distribution](../devel_docs/publication.md) for release copy, assets, and distribution decisions.
- Follow the [release workflow](../.github/workflows/release.yaml) and [release PR requirements](../CONTRIBUTING.md#release-prs).
