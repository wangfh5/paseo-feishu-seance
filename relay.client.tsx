import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { relayBind, relayStatus, relayUnbind } from "./relay.shared";

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
