# Publication and distribution

## Current decision

Emend is distributed through the public GitHub repository and manual installation. There is **no plan to submit Emend to the Obsidian Community Directory** at this time.

- Repository: https://github.com/chliu1990/obsidian-emend
- Installation: [BRAT](../INSTALLATION.md#install-with-brat) (recommended), [release ZIP](../INSTALLATION.md#install-from-the-release-zip), or [manual source installation](../INSTALLATION.md)
- Release automation: [GitHub release workflow](../.github/workflows/release.yaml)
- Release assets: `main.js`, `manifest.json`, `styles.css`, and `emend-2.7.0.zip` (a ready-to-extract `emend/` folder)
- Release tags must exactly match `manifest.json`, without a leading `v`.

This decision follows the Obsidian community directory's fork policy and the project's current lineage. The original author and project remain credited in `LICENSE` and `CREDITS.md`. Do not treat the repository as an official Obsidian Community Directory listing unless this distribution decision is revisited explicitly.

Reference: [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Public launch readiness

This launch checklist does not change the distribution decision above: no Community Directory submission happens unless that decision is deliberately revisited.

- [ ] Public docs are current: [README](../README.md), [quick start](../QUICK_START.md), [installation](../INSTALLATION.md), [roadmap](../ROADMAP.md), and changelog match the packaged release.
- [ ] User-facing privacy, permission, and write-safety material states what is sent, what is stored locally, and which actions can modify notes.
- [ ] A supported platform and provider matrix covers desktop requirements, Track Changes, DeepSeek/Kimi/custom support, Web availability, and known limitations.
- [ ] Current screenshots and a short demo match the release and show the guarded editing flow.
- [ ] Announcement and showcase copy is concise and evidence-backed, citing shipped behavior and verification records rather than deferred features.
- [ ] A clean packaged installation and release verification pass from the release ZIP and release assets in an empty vault.
- [ ] Launch-relevant security and CI review is complete. Major TypeScript, lint, and action migrations remain separately tracked and do not block launch unless security- or release-breaking.
- [ ] Confirm the documented no-submission decision or record a new explicit decision.

Complete this checklist alongside the release checklist; it records launch material and verification, not new runtime behavior.

## Release checklist

1. Run clean install, lint, tests, production build, and security review.
2. Confirm `package.json`, `manifest.json`, `package-lock.json`, and `versions.json` agree on the release version.
3. Create or dispatch a matching Git tag through the release workflow.
4. Verify the GitHub Actions run and all four uploaded assets.
5. Test the release assets in a clean vault before announcing the release.
