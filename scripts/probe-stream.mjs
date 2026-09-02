// 验证 agent.timeline.subscribe 的事件流形状（独立于插件 UI）。
// 起一个一次性 agent，发一句废话 prompt，观察事件序列，然后归档。
import { createPaseoClient } from "@getpaseo/client";

const client = createPaseoClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();
console.log("connected");

const avail = await client.providers.listAvailable();
const provider = avail.providers.find((p) => p.available)?.provider;
const models = await client.providers.listModels(provider, { cwd: "/tmp" });
const model = models.models.find((m) => m.isDefault)?.id ?? models.models[0].id;
console.log("using", provider, "/", model);

const handle = await client.agents.create({
  cwd: "/tmp",
  config: { provider: `${provider}/${model}` },
  prompt: "Reply with exactly one word: PONG",
  title: "feishu-relay-stream-probe",
});
console.log("agent:", handle.id);

const unsub = handle.timeline.subscribe((stream) => {
  const e = stream.event;
  if (e.type === "timeline") {
    const item = e.item;
    console.log(
      "event timeline:",
      item.type,
      "text" in item ? JSON.stringify(item.text?.slice(0, 60)) : "",
      "status" in item ? item.status : "",
    );
  } else {
    console.log("event:", e.type, e.type === "turn_failed" ? e.error : "");
  }
});

const result = await handle.waitForFinish(120_000);
console.log("turn result:", result.status, "| lastMessage:", JSON.stringify(result.lastMessage)?.slice(0, 200));
unsub();
await handle.archive();
await client.close();
console.log("done");
process.exit(0);
