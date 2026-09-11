import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeClient } from "./client/seance";
import { seanceBind } from "./shared/seance";

export default function contribute(client: PluginClientContext) {
  client.addCommandCenterItem({
    id: "channel-feishu",
    title: "通灵到飞书 (Feishu séance)",
    icon: "Bird",
    keywords: ["feishu", "seance", "飞书", "通灵"],
    context: "agent",
    async onSelect({ rpc, agent, workspace }) {
      // 静默降灵：反馈走飞书里的「🔮 已降灵」确认消息，不开任何窗口
      await rpc(seanceBind, { agentId: agent.id, workspaceId: workspace.id, title: agent.title ?? undefined });
    },
  });
  return contributeClient(client);
}
