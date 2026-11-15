import { z } from "zod"

export const nativeMcpMode = z.enum(["off", "on-demand", "always"])
export const nativeMcpPolicy = z.record(z.string().min(1).max(256), nativeMcpMode)
export const nativeMcpToolInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("activate"), server: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal("release"), server: z.string().min(1).max(256) }).strict(),
])
