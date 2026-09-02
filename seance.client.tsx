import { type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import React from "react";
import { Image, Text, View } from "react-native";
import { FEISHU_LOGO_DATA_URI } from "./feishu-logo.client";
import { seanceStatus, seanceUnbind } from "./seance.shared";

// 极简设计：胶囊只挂在被降灵的那个会话上，作为「占用指示 + 点击归位」。
// 未绑定的会话上没有任何视觉元素；降灵入口是 ⌘K。
// 图标是内嵌 base64 的飞书纸飞机（插件的 Icon 组件只支持 Lucide 图标名，
// 品牌图标只能以图片形式内嵌）。
function ChannelingPill({ theme }: PluginComposerPillProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Image source={{ uri: FEISHU_LOGO_DATA_URI }} style={{ width: 18, height: 14 }} />
      <Text numberOfLines={1} style={{ color: theme.colors.accent, flexShrink: 1, lineHeight: 16 }}>
        通灵中
      </Text>
    </View>
  );
}

export function contributeClient(client: PluginClientContext) {
  let removePill: (() => void) | null = null;
  let currentAgentId: string | null = null;

  const sync = async () => {
    let status;
    try {
      status = await client.rpc(seanceStatus, {});
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
      id: "feishu-seance",
      title: "通灵中，点击归位",
      workspaceId: binding.workspaceId,
      agentId: binding.agentId,
      Component: ChannelingPill,
      async onPress() {
        await client.rpc(seanceUnbind, {});
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
