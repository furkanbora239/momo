#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DIST_PATH = join(SCRIPT_DIR, "..", "dist", "index.js")
const IMPORT_LINE = 'import { createRequire as __omoCreateRequire } from "node:module";'
const BUN_REQUIRE_LINE = "var __require = import.meta.require;"
const NODE_SAFE_REQUIRE_LINE = 'var __require = typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url);'

export function patchNodeRequireShim(original: string, distPath: string): { content: string; status: "already-patched" | "patched" | "not-needed" } {
  if (original.includes(NODE_SAFE_REQUIRE_LINE)) {
    return { content: original, status: "already-patched" }
  }

  if (!original.includes(BUN_REQUIRE_LINE)) {
    if (/\b__require\s*\(/.test(original)) {
      throw new Error(`Expected Bun require helper not found in ${distPath}, but __require calls remain`)
    }
    return { content: original, status: "not-needed" }
  }

  return {
    content: original.replace(BUN_REQUIRE_LINE, `${IMPORT_LINE}\n${NODE_SAFE_REQUIRE_LINE}`),
    status: "patched",
  }
}

if (import.meta.main) {
  const original = readFileSync(DIST_PATH, "utf-8")
  const result = patchNodeRequireShim(original, DIST_PATH)
  if (result.status === "patched") {
    writeFileSync(DIST_PATH, result.content, "utf-8")
    console.log("Patched Node/Electron require shim in dist/index.js")
  } else if (result.status === "already-patched") {
    console.log("Node/Electron require shim already present in dist/index.js, skipping.")
  } else {
    console.log("No Bun require helper or unresolved __require calls in dist/index.js, skipping.")
  }
}
