import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import React from "react";
import { Text } from "react-native";
import { relayStatus, relayUnbind } from "./relay.shared";

// 极简设计：胶囊只挂在被绑定的那个会话上，作为「占用指示 + 一键解绑」。
// 未绑定的会话上没有任何视觉元素；绑定入口是 ⌘K。
function BoundPill({ theme }: PluginComposerPillProps) {
  return (
    <>
      <Icon name="Send" size={14} color={theme.colors.accent} />
      <Text numberOfLines={1} style={{ color: theme.colors.accent, flexShrink: 1 }}>
        飞书已连接
      </Text>
    </>
  );
}

export function contributeClient(client: PluginClientContext) {
  let removePill: (() => void) | null = null;
  let currentAgentId: string | null = null;

  const sync = async () => {
    let status;
    try {
      status = await client.rpc(relayStatus, {});
    } catch {
      return; // 插件重载中等瞬态失败，下轮再说
    }
    const binding = status.binding;
    if ((binding?.agentId ?? null) === currentAgentId) return;
    removePill?.();
    removePill = null;
    currentAgentId = null;
    if (!binding) return;
    currentAgentId = binding.agentId;
    removePill = client.addComposerPill({
      id: "feishu-relay",
      title: "飞书中继",
      workspaceId: binding.workspaceId,
      agentId: binding.agentId,
      Component: BoundPill,
      async onPress() {
        await client.rpc(relayUnbind, {});
      },
    });
  };

  void sync();
  const timer = setInterval(() => void sync(), 5000);
  return () => {
    clearInterval(timer);
    removePill?.();
  };
}
