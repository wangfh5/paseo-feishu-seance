import { type PluginButtonIconProps, type PluginClientContext } from "@getpaseo/plugin/client";
import { Image } from "react-native";
import { FEISHU_LOGO_DATA_URI } from "./feishu-logo";
import { seanceStatus, seanceUnbind } from "../shared/seance";

// 极简设计：胶囊只挂在被降灵的那个会话上，作为「占用指示 + 点击归位」。
// 未绑定的会话上没有任何视觉元素；降灵入口是 ⌘K。
// 0.8 的胶囊固定显示 icon + label；品牌图标以自定义 icon 组件内嵌
// （button.icon 接受 Lucide 名或 ComponentType<PluginButtonIconProps>）。
function FeishuBirdIcon({ size }: PluginButtonIconProps) {
  const s = size ?? 18;
  return (
    <Image
      source={{ uri: FEISHU_LOGO_DATA_URI }}
      style={{ width: s, height: s * (14 / 18) }}
    />
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
    const pill = client.addComposerPill({
      id: "feishu-seance",
      workspaceId: binding.workspaceId,
      agentId: binding.agentId,
      button: {
        title: "通灵中，点击归位",
        icon: FeishuBirdIcon,
        label: "通灵中",
        behavior: {
          kind: "action",
          async onPress() {
            await client.rpc(seanceUnbind, {});
          },
        },
      },
    });
    removePill = () => pill.remove();
  };

  // 桌面端关窗会 archive；client 侧目录流比插件子进程更稳，顺手触发归位。
  const unsubAgents = client.paseo.agents.subscribe((update: {
    kind: string;
    agentId?: string;
    agent?: { id: string; archivedAt?: string | null };
  }) => {
    if (!currentAgentId) return;
    const gone =
      (update.kind === "remove" && update.agentId === currentAgentId) ||
      (update.kind === "upsert" && update.agent?.id === currentAgentId && Boolean(update.agent.archivedAt));
    if (!gone) return;
    void client.rpc(seanceUnbind, {}).then(() => void sync());
  });

  void sync();
  const timer = setInterval(() => void sync(), 5000);
  return () => {
    clearInterval(timer);
    unsubAgents();
    removePill?.();
  };
}
