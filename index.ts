import type { PluginContext } from "@getpaseo/plugin";
import { RelayPanel } from "./relay.client";
import { relayBind, relayStatus, relayUnbind } from "./relay.shared";
import { handleBind, handleStatus, handleUnbind, shutdownRelay } from "./relay.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(relayBind, handleBind);
  plugin.handle(relayUnbind, handleUnbind);
  plugin.handle(relayStatus, handleStatus);

  plugin.addWorkspacePanel({
    id: "relay",
    title: "飞书中继",
    icon: "Send",
    context: "agent",
    Component: RelayPanel,
  });
  plugin.addCommandCenterItem({
    id: "bind-feishu",
    title: "接到飞书 (Feishu relay)",
    icon: "Send",
    keywords: ["feishu", "relay", "飞书"],
    context: "agent",
    async onSelect({ rpc, agent }) {
      // 静默绑定：反馈走飞书里的「🔗 已绑定」确认消息，不打开面板
      await rpc(relayBind, { agentId: agent.id, title: agent.title ?? undefined });
    },
  });

  return () => {
    shutdownRelay();
  };
}
