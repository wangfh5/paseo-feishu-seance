import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./seance.client";
import { seanceBind, seanceStatus, seanceUnbind } from "./seance.shared";
import { handleBind, handleStatus, handleUnbind, shutdownSeance } from "./seance.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(seanceBind, handleBind);
  plugin.handle(seanceUnbind, handleUnbind);
  plugin.handle(seanceStatus, handleStatus);
  plugin.addClientSide(contributeClient);

  plugin.addCommandCenterItem({
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

  return () => {
    shutdownSeance();
  };
}
