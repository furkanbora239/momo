import { exportDecisionTrainingSet } from "../packages/omo-opencode/src/features/decision-ledger/export"

type CliArgs = {
  ledger?: string
  out?: string
  source?: "jev" | "fallback"
  hasOutcome?: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--ledger") {
      args.ledger = argv[++i]
    } else if (token === "--out") {
      args.out = argv[++i]
    } else if (token === "--source") {
      const value = argv[++i]
      if (value === "jev" || value === "fallback") {
        args.source = value
      } else {
        throw new Error(`--source must be "jev" or "fallback", got: ${value}`)
      }
    } else if (token === "--has-outcome") {
      args.hasOutcome = true
    }
  }
  return args
}

export async function runExportDecisions(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (!args.ledger || !args.out) {
    console.error(
      "usage: export-decisions --ledger <path> --out <path> [--source jev|fallback] [--has-outcome]",
    )
    return 1
  }

  const result = await exportDecisionTrainingSet({
    ledgerPath: args.ledger,
    outputPath: args.out,
    filter: {
      source: args.source,
      hasOutcome: args.hasOutcome,
    },
  })

  console.log(`exported=${result.exported} skipped=${result.skipped}`)
  return 0
}

if (import.meta.main) {
  const exitCode = await runExportDecisions(Bun.argv.slice(2))
  process.exit(exitCode)
}
