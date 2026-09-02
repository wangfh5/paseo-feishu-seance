# paseo-feishu-relay

A [Paseo](https://paseo.sh) plugin that relays a live agent session to a Feishu (Lark) bot. Bind the session you are watching, walk away from your desk, and keep the conversation going from your phone: agent replies land in Feishu as rendered Markdown cards, and messages you send the bot are fed back to the bound agent as prompts.

> The Paseo plugin API is experimental. Developed and tested against Paseo daemon **0.7.0**.

## What it does

- **Bind / unbind** the focused agent from a Command Center item ("接到飞书") or the plugin's agent panel.
- **Outbound**: assistant messages are accumulated per turn and pushed to Feishu as a Card JSON 2.0 markdown card when the turn completes. Permission requests and turn failures are pushed as notifications.
- **Inbound**: plain text, images, and rich-text/image-mixed (`post`) messages sent to the bot are forwarded to the bound agent via `send(text, { images })`. `/status` reports the current binding.
- **Dry-run mode**: without a Feishu config file, everything works except actual delivery — outbound messages go to the plugin log (`paseo plugin logs feishu-relay`).

## Security model (read this)

The bot is a **remote prompt channel into your machine**. Anyone whose messages reach the bot can drive the bound agent with the agent's own permissions.

- Inbound messages are accepted only from `allowedChatIds` in the config. Keep it to your own private chat with the bot.
- Paseo plugin backend code runs unsandboxed on the daemon machine. `appSecret` never leaves the daemon side.

## Feishu app setup

You need a self-built (企业自建) Feishu app:

1. [open.feishu.cn](https://open.feishu.cn) → Developer console → create an enterprise self-built app. Note the **App ID** and **App Secret**.
2. Add the **Bot** capability.
3. Permissions: `im:message`, `im:message:send_as_bot`.
4. Event subscription: choose **long connection** (使用长连接接收事件) — no public webhook needed — and subscribe to `im.message.receive_v1`.
5. Create a version and publish (may require tenant admin approval).
6. In the Feishu client, open a private chat with the bot and send any message once.

The `chatId` of that private chat is not shown in the client UI. Bootstrap trick: set `chatId` to a dummy value, reload the plugin, send the bot a message, and read the real `oc_...` id from `paseo plugin logs feishu-relay` (`rejected message from non-whitelisted chat: oc_...`).

## Install

From Git (runs `npm ci` via the manifest `build` step — requires Paseo ≥ 0.7.2):

```bash
paseo plugin add <owner>/paseo-feishu-relay
```

For local development:

```bash
git clone <this repo> && cd paseo-feishu-relay
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-feishu-relay
```

Then create `~/.paseo/feishu-relay.config.json` from [feishu.config.example.json](feishu.config.example.json):

| Field | Meaning |
| --- | --- |
| `appId` / `appSecret` | Feishu app credentials |
| `chatId` | Outbound target chat (your private chat with the bot) |
| `allowedChatIds` | Inbound whitelist; defaults to `[chatId]` |
| `pluginDir` | Absolute path of this repo — used to lazy-load the lark SDK (see dev notes) |

Reload after changing the config: `paseo plugin reload feishu-relay`.

## Usage

1. Open an agent tab, **⌘K** → "接到飞书 (Feishu relay)". The bot confirms the binding in Feishu.
2. Every completed turn is pushed to Feishu as a card.
3. Reply in Feishu to steer the agent. Send `/status` to check the current binding.
4. Unbind from the plugin panel or by rebinding another session.

## Known limitations

- After a plugin reload or daemon restart, the timeline subscription is rebuilt lazily on the first RPC (the panel polls every 5 s; rebinding works too). Turns completed in that gap are not pushed.
- Feishu's long connection is at-least-once: events not acked (e.g. while the plugin was wedged) are redelivered later. There is **no `message_id` dedup yet** — a stale message can arrive as a fresh prompt after recovery.
- Permission requests are push-only; approval still requires the desktop client.
- Tool calls are counted, not detailed; very long replies are not split.

## Dev notes (battle scars, Paseo 0.7.0)

- `@larksuiteoapi/node-sdk` is CJS and references `__dirname` at module top level; a static import crashes the ESM server bundle at load. It is lazy-loaded via `createRequire`, which is why the config needs `pluginDir` — the plugin subprocess runs with cwd `/`, has no plugin-dir env var, and `import.meta.url` is stripped by the bundler.
- `assistant_message` stream events are provider-dependent: some providers send deltas, others cumulative text. Aggregation uses a prefix heuristic (new text starts with the buffered text → replace, else append).
- Feishu inbound is not just `text`: quoted messages and image+text mixes arrive as `post` (rich-text JSON). Images are downloaded via `im.message.resource` and forwarded base64-encoded.
- With a live WS client/subscription, the daemon's plugin stop can hang (`Stopping plugin` forever, queueing all later lifecycle commands). The contribution cleanup force-exits the subprocess.
- Plugin RPCs cannot be invoked from external scripts: the `@getpaseo/client` bundle validates outbound messages against an older embedded protocol schema that lacks `plugin.rpc.invoke.request`.

Similar projects worth stealing ideas from: [opencode-feishu](https://github.com/NeverMore93/opencode-feishu) (CardKit 2.0 streaming cards, card-button approvals), [pi-feishu-lark](https://github.com/AX1202/pi-feishu-lark), [dsh-bridge](https://github.com/wenbin-wb/dsh-bridge).

## License

[MIT](LICENSE)
