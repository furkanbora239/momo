import { getOpenCodeVersion } from "./opencode-version"

export type OpenCodeVersionProbeResult = {
  readonly available: boolean
  readonly version: string | null
  readonly major: number | null
}

export type OpenCodeVersionProbeOptions = {
  readonly version?: () => string | null
}

export type OpenCodeVersionProbe = () => OpenCodeVersionProbeResult

export function isOpenCodeV2(major: number | null): boolean {
  return major !== null && major >= 2
}

export function majorFromVersion(version: string | null): number | null {
  if (version === null) return null
  const match = /(\d+)/.exec(version.trim())
  return match ? Number(match[1]) : null
}

function probeResult(version: string | null): OpenCodeVersionProbeResult {
  return {
    available: version !== null,
    version,
    major: majorFromVersion(version),
  }
}

export function createOpenCodeVersionProbe(options: OpenCodeVersionProbeOptions = {}): OpenCodeVersionProbe {
  const version = options.version ?? getOpenCodeVersion
  let cache: OpenCodeVersionProbeResult | undefined
  return () => {
    if (cache === undefined) cache = probeResult(version())
    return cache
  }
}

export const defaultOpenCodeVersionProbe: OpenCodeVersionProbe = createOpenCodeVersionProbe()
