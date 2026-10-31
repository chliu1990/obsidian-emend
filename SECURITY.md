# Security policy

## Supported versions

Security fixes are provided for the latest released minor version of Emend and for the `main` branch. Update to the newest release before reporting reproducible issues.

## Report a vulnerability

Use a [private GitHub security advisory](https://github.com/chliu1990/obsidian-emend/security/advisories/new) when possible. If private advisories are unavailable, contact the repository owner through GitHub rather than opening a public issue.

Include the affected version, reproduction steps, impact, and a minimal sanitized proof of concept. Do not include API keys, tokens, authorization headers, private notes, or other vault data. Do not publicly disclose the issue until a fix and coordinated disclosure date have been agreed.

## Sensitive areas

- API-key handling and SecretStorage migration
- Provider request/error redaction
- Note-write permissions and stale/abort checks
- Vault path, skill, attachment, and context loading
- Model/Markdown rendering and external content
- Conversation persistence and local data deletion
- CI credentials, release assets, and dependency updates

Security-sensitive changes require focused tests and an independent security review before release.
