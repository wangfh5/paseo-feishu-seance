# paseo-feishu-seance

**Hold a séance for a running [Paseo](https://paseo.sh) agent.** One keystroke channels the session you are watching into a Feishu (Lark) bot — the agent's spirit descends into the chat (降灵), and you keep the conversation going from your phone while away from your desk. Its replies arrive in Feishu as rendered Markdown cards; messages you send the bot possess the session as prompts. When you are back, one tap on the composer pill sends the spirit home (归位).

> The Paseo plugin API is experimental. Developed and tested against Paseo daemon **0.7.0**.

## What it does

- **降灵 / Channel**: **⌘K** → "通灵到飞书 (Feishu séance)" channels the focused agent. No window opens; the bot confirms in Feishu, and a "通灵中" pill appears above that session's composer. The pill shows up **only** on the channeled session — it is the occupancy indicator and one-tap 归位 (unbind). Unbound sessions carry no UI at all.
- **Outbound**: assistant messages are accumulated per turn and pushed to Feishu as a Card JSON 2.0 markdown card when the turn completes. Permission requests and turn failures are pushed as notifications.
- **Inbound**: plain text, images, and rich-text/image-mixed (`post`) messages sent to the bot are forwarded to the channeled agent via `send(text, { images })`. A message arriving mid-turn **interrupts** the running turn (same semantics as typing in the desktop client; client-side queueing is a UI feature the plugin bypasses). `/status` reports the current channel.
- **Dry-run mode**: without a Feishu config file, everything works except actual delivery — outbound messages go to the plugin log (`paseo plugin logs feishu-seance`).

## Security model (read this)

The bot is a **remote prompt channel into your machine**. Anyone whose messages reach the bot can drive the channeled agent with the agent's own permissions.

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

The `chatId` of that private chat is not shown in the client UI. Bootstrap trick: set `chatId` to a dummy value, reload the plugin, send the bot a message, and read the real `oc_...` id from `paseo plugin logs feishu-seance` (`rejected message from non-whitelisted chat: oc_...`).

## Install

Local directory install (works on Paseo 0.7.0):

```bash
git clone https://github.com/wangfh5/paseo-feishu-seance.git && cd paseo-feishu-seance
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-feishu-seance
```

Git install (`paseo plugin add wangfh5/paseo-feishu-seance`) needs the lark SDK installed in the plugin directory, which requires the manifest `build` step — supported only on Paseo ≥ 0.7.2, which is also the first version whose manifest schema accepts the `build` key. This repo deliberately omits `build` to stay installable on 0.7.0; when 0.7.2+ is the floor, add `"build": [["npm", "ci"]]` to `paseo-plugin.json` and Git installs become self-contained.

Then create `~/.paseo/feishu-seance.config.json` from [feishu-seance.config.example.json](feishu-seance.config.example.json) (the legacy name `feishu-relay.config.json` is still read as a fallback):

| Field | Meaning |
| --- | --- |
| `appId` / `appSecret` | Feishu app credentials |
| `chatId` | Outbound target chat (your private chat with the bot) |
| `allowedChatIds` | Inbound whitelist; defaults to `[chatId]` |
| `pluginDir` | Absolute path of this repo — used to lazy-load the lark SDK (see dev notes) |

Reload after changing the config: `paseo plugin reload feishu-seance`.

## Usage

1. Open an agent tab, **⌘K** → "通灵到飞书 (Feishu séance)". The bot confirms in Feishu (🔮 已降灵), and the "通灵中" pill appears on that session.
2. Every completed turn is pushed to Feishu as a card.
3. Reply in Feishu to steer the agent. Send `/status` to check the current channel.
4. Tap the pill to 归位, close/archive the channeled session, or channel another session to move the séance. Archiving the session (closing its window) also 归位 and the bot confirms in Feishu.

### Multiple daemons

You can install the plugin on several daemons with the same bot. Bindings are **per-daemon**: there is no cross-daemon coordination, so discipline is the protocol — 归位 the current session on one machine before channeling a session on another, or both daemons will push into the same chat and inbound prompts will be handled by both. (Feishu's long connection broadcasts events to every connected instance, so a shared-registry design is possible — deliberately left out to keep the plugin simple and infra-free.)

## Known limitations

- After a plugin reload or daemon restart, the timeline and archive watches are rebuilt lazily on the first RPC (the pill's sync loop triggers it within 5 s; re-channeling works too). Turns completed in that gap are not pushed.
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
