import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const bindingSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  title: z.string().optional(),
  boundAt: z.string(),
});
export type RelayBinding = z.output<typeof bindingSchema>;

export const relayBind = defineRpc({
  name: "relay.bind",
  input: z.object({ agentId: z.string(), workspaceId: z.string(), title: z.string().optional() }),
  output: z.object({ ok: z.boolean(), configured: z.boolean() }),
});

export const relayUnbind = defineRpc({
  name: "relay.unbind",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const relayStatus = defineRpc({
  name: "relay.status",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    configPath: z.string(),
    binding: bindingSchema.nullable(),
    forwardedTurns: z.number(),
  }),
});
