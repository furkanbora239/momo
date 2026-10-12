# Native search candidate

`candidate.json` pins the official `codebase-memory-mcp` v0.11.0 Darwin ARM64 artifact and its upstream MIT license text by SHA-256. Explicit managed provisioning writes that exact license beside the cached binary as `LICENSE`; runtime resolution rejects a binary whose license file is missing or mismatched. It stays disabled because the fixture failed automatic freshness: after editing a source file, the new symbol was absent until a full manual reindex. The process was isolated with documented `CBM_CACHE_DIR` and `XDG_CONFIG_HOME` roots; the verified archive and cache stayed under task-specific temporary directories. No installer or global configuration was used.

The release exposes 17 MCP tools. The candidate requires `index_repository`, `search_graph`, `trace_path`, `check_index_coverage`, and `list_projects`. Its freshness tool labels coverage `best_effort`; a clean result is not proof of complete indexing, so roles must read source and verify claims when coverage is incomplete or uncertain. Large work should use async indexing and poll `index_status`; the release documents cancellation of orphaned synchronous indexing requests.

The independent fixture QA is runnable with:

```sh
bun packages/omo-opencode/src/native-search/scripts/qa-mcp-release.mjs /absolute/path/to/codebase-memory-mcp
```

It checks the MCP handshake and schemas, indexing, symbol search, caller/callee traversal, coverage metadata, parallel read queries, changed-source freshness without reindexing, manual reindex, and process reconnect. Evidence from the pinned binary is in `.omo/evidence/20261011-native-search/mcp-qa.json`; its `automaticFreshness` field is `false`. The manual full-reindex flow works. Native-role integration is still pending, so this candidate is not attached to role tool lists. The planned fallback surfaces are native `lsp`, `ast_grep`, `read`, and `rg`; this fixture did not verify their role-level wiring.

Official references: [v0.11.0 release](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.11.0) and [upstream tool contract](https://github.com/DeusData/codebase-memory-mcp#-mcp-tools).
