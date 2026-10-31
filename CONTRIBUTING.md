# Contributing to Emend

Emend welcomes focused bug reports, documentation improvements, and independently scoped features. The project is maintained primarily by one developer, so clear reproduction steps and small PRs matter more than volume or speed.

## Development principles

- Keep `main` releasable. Create feature branches from `main`; do not commit feature work directly to it.
- Give each PR one reviewable behavior and a clear goal. Split at capability boundaries, not arbitrary file counts.
- Preserve explicit user actions, note-write permission checks, SecretStorage, and the no-background-request guarantee.
- Do not add telemetry, hidden vault scans, automatic uploads, or provider behavior without a user-facing reason and documentation.
- Preserve original attribution and never include real credentials, private notes, or personal vault data in tests, logs, issues, or screenshots.

## Before a PR

1. Open or reference an issue describing the behavior and rationale.
2. Confirm the goal, non-goals, affected risk areas, and test approach.
3. Keep version bumps and release chores out of feature PRs unless the change is specifically a release PR.

For behavior changes, include focused unit tests and a real-Obsidian scenario where practical. Provider, storage, write-path, and CI changes receive an independent code/security review even when the maintainer is the only developer.

## Required checks

```bash
npm ci
npm test
npm run lint
npm run build
git diff --check
```

The PR should also document:

- Behavior changed and intentional non-goals.
- Privacy, network, storage, and note-write impacts.
- Automated test evidence and relevant real-Obsidian evidence.
- Documentation updated and follow-ups deferred to other PRs.

## Release PRs

Use a short, separate release PR to update `CHANGELOG.md`, version metadata, installation examples, and verification evidence. `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` must agree. Tags exactly match `manifest.json`, without a leading `v`.

Patch releases cover fixes, minor releases cover backward-compatible features, and major releases cover breaking changes. There are no fixed feature deadlines.

## Community

Be respectful and constructive. Use sanitized examples and never post API keys, authorization headers, or private note content. See [SECURITY.md](SECURITY.md) for vulnerability reporting and [ROADMAP.md](ROADMAP.md) for current priorities.
