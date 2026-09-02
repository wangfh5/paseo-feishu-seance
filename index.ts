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
    async onSelect({ rpc, agent, openPanel }) {
      await rpc(relayBind, { agentId: agent.id, title: agent.title ?? undefined });
      openPanel("relay");
    },
  });

  return () => {
    shutdownRelay();
  };
}
