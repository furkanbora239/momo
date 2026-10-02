
import type { PluginContext } from "../plugin/types"
import { runNotificationCommand } from "./session-notification-runner"
import { getAplayPath, getNotifySendPath, getPaplayPath } from "./session-notification-utils"

export async function sendLinuxSessionNotification(
  ctx: PluginContext,
  title: string,
  message: string
): Promise<void> {
  const notifySendPath = await getNotifySendPath()
  if (!notifySendPath) return

  await runNotificationCommand(
    ctx,
    notifySendPath,
    [title, message],
    (shell) => shell`${notifySendPath} ${title} ${message} 2>/dev/null`
  )
}

export async function playLinuxSessionNotificationSound(ctx: PluginContext, soundPath: string): Promise<void> {
  const paplayPath = await getPaplayPath()
  if (paplayPath) {
    await runNotificationCommand(
      ctx,
      paplayPath,
      [soundPath],
      (shell) => shell`${paplayPath} ${soundPath} 2>/dev/null`
    )
    return
  }

  const aplayPath = await getAplayPath()
  if (!aplayPath) return
  await runNotificationCommand(
    ctx,
    aplayPath,
    [soundPath],
    (shell) => shell`${aplayPath} ${soundPath} 2>/dev/null`
  )
}
