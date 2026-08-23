#!/usr/bin/env bun
import { stderr } from "node:process"
import { runCatalogStdioServer } from "./model-catalog-server"

async function main(): Promise<void> {
  await runCatalogStdioServer(process.stdin, process.stdout)
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
