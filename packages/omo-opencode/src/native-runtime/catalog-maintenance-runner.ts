// MODIFIED: drain catalog startup/periodic work before unregistering native tools.
export function createCatalogMaintenanceRunner(options: { discover(): Promise<void>; pump(): Promise<void> }) {
  let stopping = false
  let work: Promise<void> | undefined
  return {
    stopping: () => stopping,
    run(): Promise<void> {
      if (stopping) return Promise.resolve()
      work ??= (async () => {
        await options.discover()
        if (!stopping) await options.pump()
      })().finally(() => { work = undefined })
      return work
    },
    async stop(): Promise<void> { stopping = true; await work?.catch(() => undefined) },
  }
}
