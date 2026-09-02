// 端到端验证：不走 UI，直接用 plugin.rpc.invoke.request 调 relay.bind，
// 再触发一轮对话，验证 daemon 侧的 timeline 订阅与（dry-run）转发。
import { DaemonClient } from "../node_modules/@getpaseo/client/dist/daemon-client.js";

const client = new DaemonClient({ url: "ws://127.0.0.1:6767/ws", clientId: "feishu-relay-probe", clientType: "cli" });

function invokePluginRpc(pluginId, method, input) {
  return new Promise((resolve, reject) => {
    const requestId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => reject(new Error("rpc timeout")), 15_000);
    const unsub = client.subscribeRawMessages((data) => {
      if (data?.type === "plugin.rpc.invoke.response" && data.payload?.requestId === requestId) {
        clearTimeout(timer);
        unsub();
        resolve(data.payload.output);
      } else if (data?.type === "error" && data.requestId === requestId) {
        clearTimeout(timer);
        unsub();
        reject(new Error(JSON.stringify(data).slice(0, 300)));
      }
    });
    client.sendSessionMessage({ type: "plugin.rpc.invoke.request", requestId, pluginId, method, input });
  });
}

await client.connect();

const agent = await client.createAgent({
  config: { provider: "claude", model: "claude-opus-5", cwd: "/tmp", title: "feishu-relay-rpc-probe" },
  initialPrompt: "Reply with exactly one word: PONG",
});
console.log("agent:", agent.id);

const bindResult = await invokePluginRpc("feishu-relay", "relay.bind", { agentId: agent.id, title: "rpc-probe" });
console.log("bind result:", JSON.stringify(bindResult));

// 触发一轮，让 daemon 侧订阅收到 assistant_message + turn_completed
await client.sendAgentMessage(agent.id, "Reply with exactly one word: PONG");
await new Promise((r) => setTimeout(r, 45_000));

const status = await invokePluginRpc("feishu-relay", "relay.status", {});
console.log("status:", JSON.stringify(status));

const unbind = await invokePluginRpc("feishu-relay", "relay.unbind", {});
console.log("unbind:", JSON.stringify(unbind));

try {
  await client.archiveAgent(agent.id);
} catch (e) {
  console.log("archive failed (non-fatal):", e.message);
}
await client.close();
console.log("done");
process.exit(0);
