import type { PaseoAgentUpdate } from "@getpaseo/client";
import {
  Icon,
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginComposerPillProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { relayBind, relayStatus, relayUnbind } from "./relay.shared";

// 每个 agent 输入框上方的状态胶囊：显示绑定状态，点击即绑定/解绑
function RelayPill({ theme, agentId }: PluginComposerPillProps) {
  const getStatus = useRpc(relayStatus);
  const { data } = useQuery({
    queryKey: ["feishu-relay", "status"],
    queryFn: () => getStatus({}),
    refetchInterval: 5000,
  });
  const boundHere = data?.binding?.agentId === agentId;
  const boundElsewhere = Boolean(data?.binding) && !boundHere;
  const color = boundHere ? theme.colors.accent : theme.colors.foregroundMuted;
  const label = boundHere ? "飞书已连接" : boundElsewhere ? "飞书·占用" : "接到飞书";
  return (
    <>
      <Icon name="Send" size={14} color={color} />
      <Text numberOfLines={1} style={{ color, flexShrink: 1 }}>
        {label}
      </Text>
    </>
  );
}

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();
  const unsubscribe = client.paseo.agents.subscribe((update: PaseoAgentUpdate) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    const { id: agentId, workspaceId } = update.agent;
    const title = update.agent.title ?? undefined;
    pills.get(agentId)?.();
    pills.set(
      agentId,
      client.addComposerPill({
        id: "feishu-relay",
        title: "飞书中继",
        workspaceId,
        agentId,
        Component: RelayPill,
        async onPress() {
          const status = await client.rpc(relayStatus, {});
          if (status.binding?.agentId === agentId) {
            await client.rpc(relayUnbind, {});
          } else {
            await client.rpc(relayBind, { agentId, title });
          }
        },
      }),
    );
  });
  return () => {
    unsubscribe();
    for (const remove of pills.values()) remove();
  };
}

export function RelayPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const agent = useAgent(agentId, ({ title, status }) => ({ title, status }));
  const queryClient = useQueryClient();
  const getStatus = useRpc(relayStatus);
  const bind = useRpc(relayBind);
  const unbind = useRpc(relayUnbind);

  const statusQuery = useQuery({
    queryKey: ["feishu-relay", "status"],
    queryFn: () => getStatus({}),
    refetchInterval: 5000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["feishu-relay"] });
  const bindMutation = useMutation({
    mutationFn: () => bind({ agentId, title: agent?.title ?? undefined }),
    onSettled: invalidate,
  });
  const unbindMutation = useMutation({
    mutationFn: () => unbind({}),
    onSettled: invalidate,
  });

  const relay = statusQuery.data;
  const boundHere = relay?.binding?.agentId === agentId;
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: 20 },
      label: { color: theme.colors.foregroundMuted, fontSize: 13 },
      button: {
        alignSelf: "flex-start" as const,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonText: { color: theme.colors.accentForeground },
      danger: { backgroundColor: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>飞书中继</Text>
      <Text style={styles.label}>
        当前会话：{agent?.title ?? agentId}（{agent?.status ?? "unknown"}）
      </Text>
      <Text style={styles.label}>
        飞书配置：{relay ? (relay.configured ? "已加载" : `未找到，dry-run 模式（${relay.configPath}）`) : "读取中…"}
      </Text>
      <Text style={styles.label}>
        绑定状态：
        {relay?.binding
          ? `${relay.binding.title ?? relay.binding.agentId}${boundHere ? "（本会话）" : "（另一个会话）"}`
          : "未绑定"}
      </Text>
      <Text style={styles.label}>已转发轮次：{relay?.forwardedTurns ?? 0}</Text>
      {boundHere ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="解绑飞书中继"
          style={[styles.button, styles.danger]}
          onPress={() => unbindMutation.mutate()}
        >
          <Text style={styles.buttonText}>解绑</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="把本会话接到飞书"
          style={styles.button}
          onPress={() => bindMutation.mutate()}
        >
          <Text style={styles.buttonText}>接到飞书</Text>
        </Pressable>
      )}
    </View>
  );
}
