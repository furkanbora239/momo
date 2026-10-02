import { describe, expect, it } from "bun:test"

import { createViewPoller } from "./view-poller"

type View = { readonly key: string; readonly label: string }

function view(key: string): View {
  return { key, label: `view-${key}` }
}

function createHarness(initialKey = "k0") {
  const changed: View[] = []
  const errors: Error[] = []
  let views: View[] = [view("k0")]
  const poller = createViewPoller<View>({
    directory: "/work/project",
    intervalMs: 1_000,
    initialKey,
    readView: async () => views[0] ?? view("k0"),
    viewKeyOf: (next) => next.key,
    onViewChanged: (next) => changed.push(next),
    onError: (error) => errors.push(error),
  })
  return {
    poller,
    changed,
    errors,
    setViews: (next: View[]) => {
      views = next
    },
  }
}

describe("#given a poller with an initial view key", () => {
  it("#when a tick reads the same key #then no change is emitted", async () => {
    const harness = createHarness("k0")

    await harness.poller.tick()

    expect(harness.changed).toHaveLength(0)
  })

  it("#when a tick reads a changed key #then the new view is emitted", async () => {
    const harness = createHarness("k0")
    harness.setViews([view("k1")])

    await harness.poller.tick()

    expect(harness.changed).toEqual([view("k1")])
  })

  it("#when consecutive ticks read the same new key #then the change is emitted once", async () => {
    const harness = createHarness("k0")
    harness.setViews([view("k1")])

    await harness.poller.tick()
    await harness.poller.tick()

    expect(harness.changed).toEqual([view("k1")])
  })
})

describe("#given a disposed poller", () => {
  it("#when tick runs #then nothing is read or emitted", async () => {
    const harness = createHarness("k0")
    harness.poller.dispose()
    harness.setViews([view("k1")])

    await harness.poller.tick()

    expect(harness.changed).toHaveLength(0)
  })
})

describe("#given a poller whose read fails", () => {
  it("#when a tick throws an Error #then the error is reported and polling continues", async () => {
    const changed: View[] = []
    const errors: Error[] = []
    let calls = 0
    const poller = createViewPoller<View>({
      directory: "/work/project",
      intervalMs: 1_000,
      initialKey: "k0",
      readView: async () => {
        calls += 1
        if (calls === 1) throw new Error("mirror read failed")
        return view("k1")
      },
      viewKeyOf: (next) => next.key,
      onViewChanged: (next) => changed.push(next),
      onError: (error) => errors.push(error),
    })

    await poller.tick()
    await poller.tick()

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe("mirror read failed")
    expect(changed).toEqual([view("k1")])
  })
})

describe("#given a started poller", () => {
  it("#when start is called twice #then only one timer chain runs", async () => {
    const harness = createHarness("k0")
    harness.poller.start()
    harness.poller.start()
    harness.poller.dispose()

    expect(harness.changed).toHaveLength(0)
  })
})
