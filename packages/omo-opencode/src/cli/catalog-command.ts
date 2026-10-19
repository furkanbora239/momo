import type { Command } from "commander"
import { homedir } from "node:os"
import { join } from "node:path"
import { createNativeCatalogKnowledgeStore } from "../native-catalog/knowledge-store"
import {
  createModelCardContribution,
  exportModelCardContributionFile,
  validateModelCardContributionFile,
} from "../native-catalog/model-card-export"

interface CatalogExportOptions {
  readonly provider: string
  readonly model: string
  readonly canonical: string
  readonly output: string
  readonly alias?: string[]
  readonly force?: boolean
}

interface CatalogCommandOptions {
  readonly homeDirectory?: string
  readonly write?: (message: string) => void
}

export function configureCatalogCommand(program: Command, options: CatalogCommandOptions = {}): void {
  const write = options.write ?? ((message: string) => console.log(message))
  const catalog = program.command("catalog").description("Validate and export shared model research contributions")

  catalog.command("validate <file>")
    .description("Validate a model catalog contribution JSON file")
    .action((file: string) => {
      const document = validateModelCardContributionFile(file)
      write(`Validated ${document.models.length} model card(s).`)
    })

  catalog.command("export")
    .description("Export one local research entry as a provider-independent contribution")
    .requiredOption("--provider <provider>", "Local provider identifier")
    .requiredOption("--model <id>", "Local model identifier")
    .requiredOption("--canonical <id>", "Reviewed canonical model identity")
    .requiredOption("--output <file>", "Contribution JSON destination")
    .option("--alias <id>", "Exact model alias; repeat for multiple aliases", (alias: string, previous: string[]) => [...previous, alias], [])
    .option("--force", "Replace an existing destination file")
    .action((args: CatalogExportOptions) => {
      const storePath = join(options.homeDirectory ?? process.env.OPENCODE_TEST_HOME ?? homedir(), ".omo", "native", "catalog-knowledge.json")
      const entry = createNativeCatalogKnowledgeStore(storePath).readEntry({ providerID: args.provider, id: args.model })
      if (!entry) throw new Error(`No local research found for ${args.provider}/${args.model}`)
      const document = createModelCardContribution(entry, args.canonical, args.alias)
      exportModelCardContributionFile(args.output, document, args.force)
      write(`Exported ${args.canonical} to ${args.output}. Review sources and aliases before submitting a PR.`)
    })
}
