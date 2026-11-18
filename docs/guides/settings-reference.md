# Settings reference

Use this guide when you want to configure a provider, control request context, or set capacity and Web limits.

You will learn how to:

- configure DeepSeek, Kimi, or a custom OpenAI-compatible provider;
- choose or discover models and set reasoning and usage reporting;
- control history, context size, and Selection context;
- set Web research limits and optional context capacity.

Open these controls in **Settings → Emend**. Non-secret settings persist locally. API keys use Obsidian SecretStorage, as described in [Local data](privacy-and-storage.md#local-data).

## Configure a provider

**Outcome:** Connect Emend to one streaming OpenAI-compatible chat endpoint.

| Provider | Preset base URL | Preset model | Request token usage |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | On |
| Kimi | `https://api.kimi.com/coding/v1` | `k3.1-pro` | On |
| Custom | Empty; enter your endpoint | Empty; enter your model | Off |

DeepSeek also offers `deepseek-v4-pro` as a built-in model. Web research is available only for DeepSeek `deepseek-flash` and `deepseek-v4-pro`. Other providers and models do not silently fall back to unsearched Chat.

**Prerequisites:** [Install and enable Emend](../../INSTALLATION.md). Have an endpoint, API key, and model name from your provider.

**Actions:**

1. Choose the **Active provider**.
2. Enter its **API key**, **base URL**, and **model**.
3. Keep the preset values when they match your account.
4. Submit a test question from [Ordinary Chat](chat-and-context.md#chat-with-the-active-note).

Emend appends `/chat/completions` to the base URL. The endpoint must support streaming chat completions. Use an HTTP(S) URL without embedded credentials.

**Observable result:** The composer names the active provider and model. A successful submission streams an answer through that endpoint.

**Recipe recap:** You selected and authenticated one provider, and should observe later explicit submissions using its configured endpoint and model.

## Choose or discover a model

**Outcome:** Select an available model without confusing local selection with network discovery.

| Task | Where to do it | Network behavior |
| --- | --- | --- |
| Choose a built-in, discovered, or current model | Composer model menu or Settings | A composer choice makes one local settings save. It makes no provider request. |
| Enter a custom model name | Settings only | Saves the name locally. It does not validate the model with a request. |
| Discover endpoint models | **Refresh models** in Settings only | Explicitly sends authenticated `GET <base URL>/models`. |
| Choose reasoning effort | Composer model menu or Settings | Saves the choice locally. The next request uses it. |

The composer lists providers only when they have a key and a usable model. Custom needs a key and a configured or discovered model. See [the composer recipe](chat-and-context.md#choose-a-provider-model-and-reasoning-effort) for its exact local-save boundary.

**Prerequisites for discovery:** Configure the provider's base URL and API key. Confirm that its endpoint supports `GET /models`.

**Actions:**

1. Open **Settings → Emend** for that provider.
2. Click **Refresh models** once.
3. Choose a returned model from the dropdown, or enter a custom model name in Settings.

Discovery never runs automatically when chat or the composer menu opens. A failed discovery preserves the previous cached list. Changing the base URL or API key clears that provider's cache.

**Observable result:** Returned models become dropdown choices after a successful refresh. The composer summary changes only after you choose a model.

**Recipe recap:** You used explicit Settings-only discovery when needed, and should observe model choices without background discovery or an automatic Chat submission.

## Set reasoning and usage reporting

**Outcome:** Control the requested reasoning level and whether the provider reports token usage.

| Setting | Choices and default | Effect |
| --- | --- | --- |
| **Reasoning effort** | **Low**, **Medium**, or **High**; default **High** | Sends the configured `reasoning_effort` with requests. Choose a level your model supports. |
| **Request token usage** | On for DeepSeek and Kimi; Off for Custom | Adds `stream_options: { include_usage: true }` when enabled. Completed responses show provider usage when valid data arrives. |

**Prerequisites:** Configure the active provider and check its model documentation.

**Actions:**

1. Choose a supported **Reasoning effort**.
2. Enable **Request token usage** if the provider supports usage in streamed responses.
3. Disable it if the provider rejects `stream_options`.
4. Submit a test request.

A provider rejection of `stream_options` is an error. Emend does not retry the Chat request without that option.

**Observable result:** A compatible completed response shows usage. With usage reporting off, Emend can show a clearly labeled character-based estimate instead.

**Recipe recap:** You chose request compatibility settings, and should observe either valid provider usage or an explicitly estimated footer.

## Control context and history

**Outcome:** Decide how much prior conversation and note context each submission can include.

| Setting | Default and range | Behavior |
| --- | --- | --- |
| **Default mode** | **Chat**; Chat or Edit | Sets the initial composer mode. It does not submit or write by itself. |
| **Include note path** | Off | Adds vault-qualified active and Related-note paths to provider prompts when enabled. |
| **Chat history messages** | `8`; integers `0`–`50` | Includes that many recent ready messages from the originating session. `0` disables history. |
| **Context character limit** | `12000`; minimum `1000` characters | Bounds Ordinary Chat's long-note window, combined Related-note sources, and Default Selection surroundings. |
| **Smart selection context** | On | Adds containing and adjacent blocks for Default Selection context. Off uses symmetric before/after context. |

The Modify Selection modal never sends chat history. Chat Selection and Full-note Edit still send the complete note. Selection targets remain complete, and Full-note Selection context never expands the edit target.

Path sharing changes provider prompts, not what your local pickers display. Review [Note paths and Related notes](privacy-and-storage.md#note-paths-and-related-notes) before enabling it.

**Prerequisites:** Decide your privacy needs and whether later requests should use earlier ready messages.

**Actions:**

1. Set **Chat history messages** to `0` for stateless requests, or choose a value through `50`.
2. Adjust **Context character limit** for bounded note and Related-note context.
3. Toggle **Smart selection context** according to the surroundings you want for Selection requests.
4. Submit a request and inspect its response.

**Observable result:** Later requests use the new history and context policy. Existing saved messages remain unchanged.

**Recipe recap:** You set explicit context and history limits, and should observe later submissions following them without rewriting saved chats.

## Set Web research limits

**Outcome:** Bound DeepSeek retrieval calls and the extracted content returned from each call.

| Setting | Default | Accepted range | What it bounds |
| --- | --- | --- | --- |
| **Web tool call limit** | `8` | Integers `1`–`20` | Executed Search and Fetch calls for one answer. Failed calls also count. |
| **Web output cap per call (characters)** | `20000` | Integers `1000`–`100000` | Each complete serialized Search/Fetch extraction payload. |

The output cap is independent for each executed call. Total tool-payload growth is at most cap × executed calls. These are character limits, not exact token counts or billing data.

**Prerequisites:** Use Chat with DeepSeek `deepseek-flash` or `deepseek-v4-pro`. Web research is Off by default and unavailable to Edit.

**Actions:**

1. Set **Web tool call limit** to the maximum retrieval work you want.
2. Set **Web output cap per call (characters)** to the largest payload you want per call.
3. Choose **Web Review** or **Web Auto** for a Chat submission.
4. Review the answer's activity and any incompleteness warning.

An over-limit batch executes only remaining call slots in model order. Skipped calls perform no retrieval, and the answer includes a warning. Cap fitting can omit extracted evidence and adds its own warning.

**Observable result:** Later Web answers respect both limits. Excess calls or omitted evidence produce visible warnings instead of hidden expansion.

**Recipe recap:** You bounded retrieval and per-call output, and should observe those limits plus warnings on later opted-in DeepSeek research.

## Configure context capacity

**Outcome:** Reserve response space and block requests whose estimated input does not fit.

Capacity is optional and configured per provider. Effective input capacity is:

`effective input = window − reserve`

Both values must be positive integers, and the window must exceed the reserve. The reserve is local accounting only. Emend never sends it as `max_tokens`.

The following values come from model documentation. They are not account-specific responses from your provider.

| Provider and exact model | Context window | Output reserve | Effective input |
| --- | ---: | ---: | ---: |
| DeepSeek `deepseek-flash` | `1048576` | `393216` | `655360` |
| DeepSeek `deepseek-v4-pro` | `1048576` | `393216` | `655360` |
| Kimi `k3.1-pro` | `1048576` | `131072` | `917504` |

DeepSeek documents 1M context and 384K maximum output for the listed models. Kimi documents up to 1M context on eligible plans and 131,072 default output. Lower-tier Kimi plans may need a smaller window.

**Prerequisites:** Use one of the exact models above, or obtain appropriate limits from your provider. Custom and unknown models require manual values.

**Actions:**

1. Open **Settings → Emend** for the provider.
2. Click **Use documented defaults** for a listed model, or enter **Context window (tokens)** and **Output reserve (tokens)** manually.
3. Leave both fields empty, or click **Clear capacity settings**, to turn checks off.
4. Return to chat and inspect the compact capacity bar below the header.

The button applies values only when clicked. Selecting a model or loading settings applies no defaults automatically. Emend does not fetch model limits or add a metadata request.

Draft estimates use character-based approximations, not exact model tokenization or billing data. Remaining input is a lower-bound estimate because the draft excludes:

- loaded instructions and skills;
- Related-note contents;
- the first Web round's system prompt and tool declarations;
- later Web, extraction, verification, refinement, or correction rounds.

The exact assembled-request check remains authoritative. A draft at or above effective capacity is blocked. Invalid settings also block requests. Blocking makes no provider request or note write, and Emend never compresses, summarizes, or truncates context automatically to make it fit.

See Stage 42 for the [remaining-input and output formulas](../../devel_docs/42-context-accounting-capacity.md#header-and-modal-capacity-bars) and the [complete preflight and per-fetch guards](../../devel_docs/42-context-accounting-capacity.md#preflight-and-transport-guards).

**Observable result:** A valid pair persists across reload and produces a live capacity bar. An invalid or oversized request is blocked with guidance and no write.

**Recipe recap:** You set a local input budget and output reserve, and should observe approximate estimates plus hard blocking without automatic compression.

## Recap

- Provider presets are editable. Only explicit **Refresh models** in Settings performs model discovery.
- Composer model and reasoning choices save locally. They do not submit a request or perform network or note I/O.
- History accepts `0`–`50`; `0` disables it. Context size bounds only the workflows listed above.
- Web calls accept `1`–`20`, and each Web output cap accepts `1000`–`100000` characters.
- Capacity uses `window − reserve`, character estimates, and hard blocking. It never compresses automatically.

Next, use [Chat and context](chat-and-context.md) to apply these settings, or review [Privacy and storage](privacy-and-storage.md) for recipients and local persistence.
