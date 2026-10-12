import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { dirname, join, resolve } from "node:path"
import {
  NATIVE_SEARCH_ARCHIVE_SHA256,
  NATIVE_SEARCH_BINARY_SHA256,
  NATIVE_SEARCH_RELEASE_URL,
  NATIVE_SEARCH_VERSION,
} from "./constants"
import { NATIVE_SEARCH_LICENSE_SHA256, NATIVE_SEARCH_LICENSE_TEXT } from "./license"

const execFile = promisify(execFileCallback)

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex")
}

function managedBinaryPath(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), "codebase-memory-mcp", NATIVE_SEARCH_VERSION, "codebase-memory-mcp")
}

function managedLicensePath(runtimeRoot: string): string {
  return join(dirname(managedBinaryPath(runtimeRoot)), "LICENSE")
}

export interface NativeSearchRuntimeOptions {
  readonly runtimeRoot: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

export async function resolveNativeSearchBinary(options: NativeSearchRuntimeOptions): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== "darwin" || (options.arch ?? process.arch) !== "arm64") return undefined
  const path = managedBinaryPath(options.runtimeRoot)
  try {
    const contents = await readFile(path)
    if (sha256(contents) !== NATIVE_SEARCH_BINARY_SHA256) return undefined
    const license = await readFile(managedLicensePath(options.runtimeRoot))
    if (sha256(license) !== NATIVE_SEARCH_LICENSE_SHA256) return undefined
    const { stdout } = await execFile(path, ["--version"])
    return stdout.trim() === `codebase-memory-mcp ${NATIVE_SEARCH_VERSION}` ? path : undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    throw new Error("native search runtime validation failed", { cause: error })
  }
}

/** Explicitly downloads and validates the pinned release into the caller's managed runtime root. */
export async function provisionNativeSearchBinary(options: NativeSearchRuntimeOptions & { readonly fetcher?: typeof fetch }): Promise<string> {
  if ((options.platform ?? process.platform) !== "darwin" || (options.arch ?? process.arch) !== "arm64") {
    throw new Error("native search v0.11.0 is currently pinned only for darwin-arm64")
  }
  const finalPath = managedBinaryPath(options.runtimeRoot)
  const existing = await resolveNativeSearchBinary(options)
  if (existing) return existing
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(NATIVE_SEARCH_RELEASE_URL)
  if (!response.ok) throw new Error(`native search release download failed with HTTP ${response.status}`)
  const archive = new Uint8Array(await response.arrayBuffer())
  if (sha256(archive) !== NATIVE_SEARCH_ARCHIVE_SHA256) throw new Error("native search release archive SHA-256 mismatch")

  const parent = dirname(finalPath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(parent, ".provision-"))
  try {
    const licenseContents = Buffer.from(NATIVE_SEARCH_LICENSE_TEXT, "utf8")
    if (sha256(licenseContents) !== NATIVE_SEARCH_LICENSE_SHA256) throw new Error("native search license SHA-256 mismatch")
    const archivePath = join(staging, "release.tar.gz")
    await writeFile(archivePath, archive, { mode: 0o600 })
    await execFile("tar", ["-xzf", archivePath, "-C", staging, "codebase-memory-mcp"])
    const stagedBinary = join(staging, "codebase-memory-mcp")
    const stagedLicense = join(staging, "LICENSE")
    const binary = await readFile(stagedBinary)
    if (sha256(binary) !== NATIVE_SEARCH_BINARY_SHA256) throw new Error("native search executable SHA-256 mismatch")
    await chmod(stagedBinary, 0o700)
    const { stdout } = await execFile(stagedBinary, ["--version"])
    if (stdout.trim() !== `codebase-memory-mcp ${NATIVE_SEARCH_VERSION}`) throw new Error("native search executable reported an unexpected version")
    await writeFile(stagedLicense, licenseContents, { mode: 0o600 })
    await rename(stagedBinary, finalPath)
    await rename(stagedLicense, managedLicensePath(options.runtimeRoot))
    return finalPath
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
