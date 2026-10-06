# Connect image generation

Scenri is the studio. A provider draws the picture. Until one is connected, the composer shows a notice and Generate waits.

Scenri never sees your ChatGPT password. Keys you paste are stored in `.scenri` on this computer and sent only to that provider.

## Codex, on a paid ChatGPT plan

This is the default. Any paid ChatGPT plan. The Free plan does not include Codex image generation.

1. Press **Set up** on the composer notice, or open Settings, **Providers**.
2. Scenri installs Codex CLI if it is missing, an official helper from OpenAI.
3. You sign in through the browser. Scenri does not ask for the password in the app.
4. Scenri checks the connection with one short Codex turn.

Images then run on the ChatGPT plan you already pay for. Scenri adds nothing to that bill. OpenAI meters the usage. Spend caps in Scenri do not apply to Codex, and Scenri records those Shots at no cost.

Scenri needs Codex CLI 0.157.1 or newer. It uses `gpt-6-sol` when your plan offers that model, and Codex's own default when it does not. If your CLI is older, the check says so and shows the update command. [Troubleshooting](TROUBLESHOOTING.md) covers a CLI that looks installed but is too old, and the Windows cases.

Codex carries up to 5 reference images on a Shot. That is why it is the one to use when a Shot has to hold a Product and a Person.

## A key, if you do not have a ChatGPT plan

Settings, **Providers**. Pick one and paste the key. You create the key on the provider's site.

| Provider | Key | Reference images | Rough cost |
|---|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | up to 4 | about $0.04 an image |
| fal | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) | none | about $0.006 an image, billed per megapixel |
| Replicate | [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) | none | about $0.003 an image |

OpenRouter draws with `google/gemini-2.5-flash-image`. Pick it when the Shot names a Product or a Person and you are not on Codex.

Replicate and fal carry no reference images. Scenri refuses a Shot that names a Product or a Person on them, rather than drawing a stand-in. A logo on those two rides as words, and the composer says so before you send.

You pay the provider directly. A monthly spend cap per paid provider is on the same Settings page. Generation stops before a cap is crossed.

fal's own bill is per megapixel, about $0.006 at Scenri's sizes, and about $0.025 to edit. Scenri's cost ledger currently records fal images at $0.003, so fal's bill runs higher than the figure Scenri shows. Replicate edits are about $0.04.

`OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN`, and `FAL_KEY` in the environment are read if you have not pasted a key in Settings.

Do not paste a key into an assistant chat. Scenri asks for it inside the app.
