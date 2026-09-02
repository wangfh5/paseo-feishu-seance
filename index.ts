import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./relay.client";
import { relayBind, relayStatus, relayUnbind } from "./relay.shared";
import { handleBind, handleStatus, handleUnbind, shutdownRelay } from "./relay.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(relayBind, handleBind);
  plugin.handle(relayUnbind, handleUnbind);
  plugin.handle(relayStatus, handleStatus);
  plugin.addClientSide(contributeClient);

  plugin.addCommandCenterItem({
    id: "bind-feishu",
    title: "接到飞书 (Feishu relay)",
    icon: "Send",
    keywords: ["feishu", "relay", "飞书"],
    context: "agent",
    async onSelect({ rpc, agent, workspace }) {
      // 静默绑定：反馈走飞书里的「🔗 已绑定」确认消息，不开任何窗口
      await rpc(relayBind, { agentId: agent.id, workspaceId: workspace.id, title: agent.title ?? undefined });
    },
  });

  return () => {
    shutdownRelay();
  };
}
