import { describe, expect, it } from "bun:test"

import {
  RESTART_FALLBACK_MESSAGE,
  SESSION_NEW_COMMAND,
  attemptSessionRestart,
} from "./restart-strategy"

type FakeResult = {
  readonly keymap: { dispatchCommand?: (command: string) => unknown }
  readonly calls: string[]
}

function fakeKeymap(impl: (command: string) => unknown): FakeResult {
  const calls: string[] = []
  const keymap = {
    dispatchCommand: (command: string): unknown => {
      calls.push(command)
      return impl(command)
    },
  }
  return { keymap, calls }
}

describe("attemptSessionRestart", () => {
  describe("#given a working keymap dispatch", () => {
    it("#when dispatch succeeds #then the command runs and no fallback is emitted", async () => {
      const { keymap, calls } = fakeKeymap(() => ({ ok: true }))
      const action = await attemptSessionRestart(keymap)
      expect(action).toEqual({ kind: "dispatched" })
      expect(calls).toEqual([SESSION_NEW_COMMAND])
    })

    it("#when the result is a resolved promise #then it counts as dispatched", async () => {
      const { keymap } = fakeKeymap(() => Promise.resolve({ ok: true }))
      expect(await attemptSessionRestart(keymap)).toEqual({ kind: "dispatched" })
    })
  })

  describe("#given the dispatch cannot run", () => {
    it("#when the result is a not-found failure #then it falls back", async () => {
      const { keymap } = fakeKeymap(() => ({ ok: false, reason: "not-found" }))
      const action = await attemptSessionRestart(keymap)
      expect(action).toEqual({ kind: "fallback" })
    })

    it("#when the result is undefined #then it falls back", async () => {
      const { keymap } = fakeKeymap(() => undefined)
      expect(await attemptSessionRestart(keymap)).toEqual({ kind: "fallback" })
    })

    it("#when the dispatch throws #then it falls back without throwing", async () => {
      const { keymap } = fakeKeymap(() => {
        throw new Error("keymap gone")
      })
      const action = await attemptSessionRestart(keymap)
      expect(action).toEqual({ kind: "fallback" })
    })

    it("#when the dispatch rejects a promise #then it falls back without throwing", async () => {
      const { keymap } = fakeKeymap(() => Promise.reject(new Error("boom")))
      const action = await attemptSessionRestart(keymap)
      expect(action).toEqual({ kind: "fallback" })
    })

    it("#when the keymap is undefined #then it falls back", async () => {
      expect(await attemptSessionRestart(undefined)).toEqual({ kind: "fallback" })
    })

    it("#when dispatchCommand is missing #then it falls back and never dispatches", async () => {
      const action = await attemptSessionRestart({})
      expect(action).toEqual({ kind: "fallback" })
      expect(RESTART_FALLBACK_MESSAGE.length).toBeGreaterThan(0)
    })
  })
})
