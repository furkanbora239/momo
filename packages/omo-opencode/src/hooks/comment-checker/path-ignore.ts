/**
 * Matches a file path against ignore globs for the comment-checker hook.
 *
 * Supported patterns:
 * - `**` matches zero or more path segments (across directory boundaries)
 * - `*` matches any characters within a single path segment
 * - an exact suffix match (pattern starts with `/` or contains no `*`) is also honored
 */
export function matchesIgnorePath(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.replaceAll("\\", "/")
  return patterns.some((pattern) => matchOne(normalized, pattern))
}

function matchOne(filePath: string, pattern: string): boolean {
  const normPattern = pattern.replaceAll("\\", "/")
  if (!normPattern.includes("*")) {
    return filePath === normPattern || filePath.endsWith("/" + normPattern) || filePath.endsWith(normPattern)
  }
  const regex = globToRegExp(normPattern)
  return regex.test(filePath)
}

function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split("/")
  const body = segments
    .map((segment) => {
      if (segment === "**") return ".*"
      const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      return escaped.replace(/\*/g, "[^/]*")
    })
    .join("/")
  return new RegExp("^(?:" + body + ")$")
}
