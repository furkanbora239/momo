import { expect, it } from "bun:test"
import type { SlotClaim } from "@opencode/plugin/tui/context"
import type { SolidRuntime } from "../../features/tui-card"
import type { SolidNode } from "./solid-loader"
import { createFakeSolidRuntime, createFakeV2TuiContext } from "./fake-tui-context"
import { registerNativeTaskSidebar, type NativeTaskReactiveRuntime } from "./native-task-sidebar"

it("uses the native slot session root and disposes mounted RPC polling on unmount", async () => {
  const fake = createFakeV2TuiContext({ directory: "/scoped/project", rpcOutput: { tasks: [] } })
  const solid = createFakeSolidRuntime()
  const effects: (() => void)[] = []
  const cleanups: (() => void)[] = []
  const reactive: NativeTaskReactiveRuntime = {
    createEffect: (effect) => { effects.push(effect); effect() },
    onCleanup: (cleanup) => { cleanups.push(cleanup) },
    createSignal: <T>(initial: T): [() => T, (value: T) => unknown] => {
      let value = initial
      return [() => value, (next) => { value = next }]
    },
  }
  let sessionID = "child-a"
  fake.ctx.data.session.root = (id) => id === "child-a" ? "root-a" : "root-b"
  const signals: AbortSignal[] = []
  fake.ctx.client.rpc.call = async (input, options) => {
    fake.clientRpcCalls.push(input)
    if (options?.signal) signals.push(options.signal)
    return new Promise(() => undefined)
  }
  let unregistered = false
  fake.ctx.ui.slot = (claim: SlotClaim) => {
    if (claim.append === "sidebar.content") claim.render({ get sessionID() { return sessionID } })
    return () => { unregistered = true }
  }
  const cleanup = registerNativeTaskSidebar(fake.ctx, solid as unknown as SolidRuntime<SolidNode>, reactive)
  expect(fake.clientRpcCalls[0]).toEqual({ rpcID: "momo.native", method: "tasks", location: { directory: "/scoped/project" }, input: { rootSessionID: "root-a" } })
  sessionID = "child-b"
  effects[0]?.()
  expect(signals[0]?.aborted).toBe(true)
  expect(fake.clientRpcCalls[1]).toMatchObject({ input: { rootSessionID: "root-b" } })
  cleanups[0]?.()
  expect(signals[1]?.aborted).toBe(true)
  cleanup()
  expect(unregistered).toBe(true)
  expect(solid.created.find((node) => node.tag === "text")?.props.wrapMode).toBe("word")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fake.clientRpcCalls).toHaveLength(2)
})
