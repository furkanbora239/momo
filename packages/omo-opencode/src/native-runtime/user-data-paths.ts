import { homedir } from "node:os"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

export function homeRoot(): string {
  return process.env.OPENCODE_TEST_HOME ?? homedir()
}

export function projectNativeRoot(directory: string): string {
  const normalized = resolve(directory)
  const projectID = createHash("sha256").update(normalized).digest("hex").slice(0, 24)
  return join(homeRoot(), ".omo", "native", "projects", projectID)
}
