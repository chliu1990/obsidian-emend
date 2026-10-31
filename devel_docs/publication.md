# Publication and distribution

## Current decision

Emend is distributed through the public GitHub repository and manual installation. There is **no plan to submit Emend to the Obsidian Community Directory** at this time.

- Repository: https://github.com/chliu1990/obsidian-emend
- Installation: [README](../README.md) and [installation guide](../INSTALLATION.md)
- Release automation: [GitHub release workflow](../.github/workflows/release.yaml)
- Release assets: `main.js`, `manifest.json`, and `styles.css`
- Release tags must exactly match `manifest.json`, without a leading `v`.

This decision follows the Obsidian community directory's fork policy and the project's current lineage. The original author and project remain credited in `LICENSE` and `CREDITS.md`. Do not treat the repository as an official Obsidian Community Directory listing unless this distribution decision is revisited explicitly.

Reference: [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Release checklist

1. Run clean install, lint, tests, production build, and security review.
2. Confirm `package.json`, `manifest.json`, `package-lock.json`, and `versions.json` agree on the release version.
3. Create or dispatch a matching Git tag through the release workflow.
4. Verify the GitHub Actions run and all three uploaded assets.
5. Test the release assets in a clean vault before announcing the release.
