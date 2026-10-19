# Shared model research

`model-catalog.json` ships with momo and is embedded in the plugin and CLI. Each
card describes one model, independently of its provider endpoint. Installed users
reuse these cards instead of repeating research. Exact, documented aliases connect
provider model IDs to a canonical model identity; do not add guessed family matches.

Keep cards short and cite primary model cards or official documentation. Record the
research date, a summary, strengths and limitations. These are published claims, not
verified task outcomes. Leave unsupported abilities out. Never include API keys,
account details, private endpoints, provider prices or runtime logs. Price and
availability are resolved separately for each current provider.

Native research stays in `~/.omo/native/catalog-knowledge.json`. Export one researched
entry with the installed CLI:

```sh
oh-my-opencode catalog export --provider example --model exact-model-id \
  --canonical vendor/model-version --alias exact-model-id \
  --output model-contribution.json
oh-my-opencode catalog validate model-contribution.json
```

Copy the exported card into the `models` array, review its identity and citations,
then open a PR targeting `dev`. Run the same validate command on this registry and
run the focused model-card tests. The existing CI runs those tests for data-only PRs
as part of the root test suite. A merged card becomes available to users in the next
momo update; installed copies never write back to this repository automatically.
