# Publication and distribution

## Current decision

Emend is distributed through the public GitHub repository and manual installation. There is **no plan to submit Emend to the Obsidian Community Directory** at this time.

- Repository: https://github.com/chliu1990/obsidian-emend
- Installation: [BRAT](../INSTALLATION.md#install-with-brat) (recommended), [release ZIP](../INSTALLATION.md#install-from-the-release-zip), or [manual source installation](../INSTALLATION.md)
- Release automation: [GitHub release workflow](../.github/workflows/release.yaml)
- Release assets: `main.js`, `manifest.json`, `styles.css`, and `emend-2.0.0.zip` (a ready-to-extract `emend/` folder)
- Release tags must exactly match `manifest.json`, without a leading `v`.

This decision follows the Obsidian community directory's fork policy and the project's current lineage. The original author and project remain credited in `LICENSE` and `CREDITS.md`. Do not treat the repository as an official Obsidian Community Directory listing unless this distribution decision is revisited explicitly.

Reference: [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Release checklist

1. Run clean install, lint, tests, production build, and security review.
2. Confirm `package.json`, `manifest.json`, `package-lock.json`, and `versions.json` agree on the release version.
3. Create or dispatch a matching Git tag through the release workflow.
4. Verify the GitHub Actions run and all four uploaded assets.
5. Test the release assets in a clean vault before announcing the release.
