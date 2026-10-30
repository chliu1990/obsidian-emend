# Installing Emend

Emend is a desktop-only Obsidian plugin. Mobile Obsidian is not supported.

## Requirements

- Desktop Obsidian **1.11.4 or newer**.
- The **Track Changes** community plugin for reviewing edits.
- Node.js **24** and npm if building from source.
- A DeepSeek, Kimi, or other OpenAI-compatible provider. You need an API key and an available model. A local OpenAI-compatible endpoint also works when it permits requests from Obsidian.

## Build from source

For a new clone of the current development branch:

```bash
git clone http://127.0.0.1:19705/cliu/obsidian-emend.git
cd obsidian-emend
git switch feat/emend-rewrite
npm ci
npm run build
```

If this repository is already on your machine:

```bash
cd /path/to/obsidian-emend
git fetch origin
git switch feat/emend-rewrite
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

Replace `/path/to/your/vault` with the vault you want to use for testing, then run:

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

## Enable the plugins

1. Open the vault in desktop Obsidian.
2. Open **Settings → Community plugins** and turn off Restricted mode if Obsidian asks.
3. Install and enable **Track Changes** from the community plugin directory.
4. Select **Reload plugins** or restart Obsidian, then enable **Emend**.
5. Open **Settings → Emend** and configure a provider as described in [QUICK_START.md](QUICK_START.md).

If Emend was already enabled, use **Reload app without saving** from the Command Palette after replacing its files.

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

1. Disable **Emend** under **Settings → Community plugins**.
2. Remove `<Vault>/.obsidian/plugins/emend/` from the vault.

Disabling Emend preserves its settings and chats. Removing `<Vault>/.obsidian/plugins/emend/` also removes its `data.json`, including provider settings and API keys. Saved conversations remain under `<Vault>/.obsidian/emend/`; remove that directory separately if you want to delete them. Do not share either location.

## Troubleshooting

- **Emend does not appear:** Confirm that `manifest.json` is directly inside `.obsidian/plugins/emend/`, the manifest ID is `emend`, and you reloaded plugins.
- **Emend does not load:** Use desktop Obsidian 1.11.4 or newer and confirm that all three required files came from the same build.
- **No review cards appear:** Enable Track Changes and use Edit mode or **Modify selected text with AI**. Ask, Discuss, and Brainstorm never edit notes.
- **Provider returns an error:** Check the base URL, model, API key, and provider support for streamed OpenAI-compatible responses. Emend appends `/chat/completions` to the base URL.
- **Custom provider rejects usage requests:** Disable **Request token usage** for that provider. Emend does not retry rejected requests automatically.
- **Local provider refuses the request:** Confirm that it accepts Obsidian's desktop `fetch` requests and any required CORS preflight. No alternate transport is used.
