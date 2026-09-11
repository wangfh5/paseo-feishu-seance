import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const bindingSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  title: z.string().optional(),
  boundAt: z.string(),
});
export type SeanceBinding = z.output<typeof bindingSchema>;

export const seanceBind = defineRpc({
  name: "seance.bind",
  input: z.object({ agentId: z.string(), workspaceId: z.string(), title: z.string().optional() }),
  output: z.object({ ok: z.boolean(), configured: z.boolean() }),
});

export const seanceUnbind = defineRpc({
  name: "seance.unbind",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const seanceStatus = defineRpc({
  name: "seance.status",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    configPath: z.string(),
    binding: bindingSchema.nullable(),
    forwardedTurns: z.number(),
  }),
});
