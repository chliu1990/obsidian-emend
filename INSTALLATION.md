# Installing Emend

Emend is a desktop-only Obsidian plugin. Mobile Obsidian is not supported.

## Requirements

- Desktop Obsidian **1.11.4 or newer**.
- Node.js **24** and npm if building from source.
- A DeepSeek, Kimi, or other OpenAI-compatible provider with an API key and available model. A local endpoint also works when it permits requests from Obsidian.
- The separate **Track Changes** community plugin if you want to review Emend edits.

> **Separate review plugin:** Emend validates edits and writes CriticMarkup. The separate [Track Changes community plugin](https://github.com/philphilphil/obsidian-track-changes) visualizes that markup and supplies Accept/Reject controls. Chat does not require Track Changes. Emend does not bundle or automatically install other plugins.

## Install with BRAT

**BRAT — Beta Reviewers Auto-update Tool** installs and updates plugins directly from GitHub releases.

1. Open **Settings → Community plugins → Browse**, search for **BRAT — Beta Reviewers Auto-update Tool**, then install and enable it.
2. Open the BRAT settings and choose **Add beta plugin**.
3. Enter the Emend repository URL:

   ```text
   https://github.com/chliu1990/obsidian-emend
   ```

4. Select the latest release if BRAT asks for a specific version.
5. After BRAT installs Emend, continue with [Enable Emend and prepare edit review](#enable-emend-and-prepare-edit-review). BRAT installs Emend only, not Track Changes.

For updates, use BRAT's update check and review the release notes first. Provider credentials remain in Obsidian SecretStorage, and saved chats remain in the vault. See the [official BRAT documentation](https://tfthacker.com/BRAT) for more options.

## Install from the release ZIP

1. Open the [GitHub releases page](https://github.com/chliu1990/obsidian-emend/releases) and download `emend-<version>.zip` for the current release.
2. Extract the ZIP into `<Vault>/.obsidian/plugins/`. The archive already contains a top-level `emend/` folder.
3. Confirm that `main.js`, `manifest.json`, and `styles.css` are directly inside `<Vault>/.obsidian/plugins/emend/`.
4. Continue with [Enable Emend and prepare edit review](#enable-emend-and-prepare-edit-review).

Do not extract into `<Vault>/.obsidian/plugins/emend/`; that would create an incorrect nested `emend/emend/` folder.

## Build from source

For a new clone of the public repository:

```bash
git clone https://github.com/chliu1990/obsidian-emend.git
cd obsidian-emend
npm ci
npm run build
```

If this repository is already on your machine:

```bash
cd /path/to/obsidian-emend
git fetch origin
git switch main
git pull --ff-only
npm ci
npm run build
```

The build creates `main.js` in the repository root. The required plugin files are:

- `main.js`
- `manifest.json`
- `styles.css`

Optional verification before installing:

```bash
npm test
npm run lint
```

## Install into a vault

Replace `/path/to/your/vault` with the vault you want to use, then run:

```bash
VAULT="/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/emend"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/emend/"
```

The resulting layout must be:

```text
your-vault/
└── .obsidian/
    └── plugins/
        └── emend/
            ├── main.js
            ├── manifest.json
            └── styles.css
```

On Windows, create the same folder and copy the three files with Explorer. Do not put the files in a nested `emend/emend/` folder.

## Enable Emend and prepare edit review

1. If you will edit notes, open **Settings → Community plugins → Browse**. Install and enable the separate **Track Changes** plugin before enabling Emend. Skip this step if you will use only Chat.
2. Open **Settings → Community plugins** and turn off Restricted mode if Obsidian asks.
3. Select **Reload plugins** or restart Obsidian, then enable **Emend**.
4. Open **Settings → Emend** and configure a provider as described in the [Quick Start](QUICK_START.md#2-configure-a-provider).

If Emend was already enabled, use **Reload app without saving** from the Command Palette after replacing its files. Track Changes is required only for edit review; its absence never changes Chat's read-only behavior.

## Update a source installation

From the repository:

```bash
git pull --ff-only
npm ci
npm run build
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/emend/"
```

Reload Obsidian. Provider settings and saved conversations remain local to the vault.

## Remove Emend

Disabling Emend preserves its settings, credentials, and saved chats. Remove each kind of data separately when you want a complete cleanup.

### API keys

Clear each provider's API key in **Settings → Emend** before removing the plugin if you also want to remove its credential. API keys live separately in Obsidian SecretStorage under `emend-api-key-deepseek`, `emend-api-key-kimi`, and `emend-api-key-custom`. Removing the plugin folder alone does not clear those secrets.

### Plugin settings and files

1. Disable **Emend** under **Settings → Community plugins**.
2. Remove `<Vault>/.obsidian/plugins/emend/` from the vault.

Removing that folder removes Emend's `data.json` and non-secret provider settings. Do not share this folder or its settings with untrusted recipients.

### Saved chats

Saved conversations remain under `<Vault>/.obsidian/emend/`. Remove that directory separately if you want to delete them. Deleting a note does not automatically delete its saved chat aggregate.

## Troubleshooting

- **Emend does not appear:** Confirm that `manifest.json` is directly inside `.obsidian/plugins/emend/`, the manifest ID is `emend`, and you reloaded plugins.
- **Emend does not load:** Use desktop Obsidian 1.11.4 or newer and confirm that all three required files came from the same build.
- **Emend still does not appear after extraction:** Check for an incorrect nested `emend/emend/` directory and move the complete inner `emend/` folder into `.obsidian/plugins/`.
- **No review cards appear after an Edit:** Install and enable the separate Track Changes plugin, then review the note again. Chat never edits notes and does not produce review cards.
- **An update does not appear in Obsidian:** Confirm that BRAT updated the release or that the three manually copied files came from the new build. Reload plugins or restart Obsidian.

For provider configuration, see the [settings reference](docs/guides/settings-reference.md#configure-a-provider). For Edit and review problems, see [Editing and review](docs/guides/editing-and-review.md). For research-specific behavior, see [Web research](docs/guides/web-research.md).
