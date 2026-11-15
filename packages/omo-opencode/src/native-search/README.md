# Native code search

The active v2 plugin registers the bundled `momo_lsp` and `momo_ast_grep` MCP servers. Both CLIs ship in the root package archive; no CodeGraph process is started. MCP initialization and tool discovery do not download ast-grep. The first real ast-grep call reuses a validated existing executable or downloads the pinned, checksum-verified release into `~/.omo/runtime/ast-grep/<platform-arch>/`. Later calls and restarts reuse it. Offline or unsupported installations return a tool error; they do not silently enable graph search. Automatic installation is enabled only for the native momo registration via `OMO_AST_GREP_AUTO_INSTALL=1`; standalone consumers retain their existing policy.

LSP starts language servers on demand. The MCP transport is bundled, not every language server. Project configuration is read from `.opencode/lsp.json`, `.omo/lsp.json` or `.omo/lsp-client.json`; user configuration is `~/.omo/native/lsp.json`. Missing language servers retain explicit installation guidance/decisions rather than installing every language at startup. Workers may rewrite; coordinators and advisors retain readonly search permissions.

Run `MOMO_NATIVE_OPENCODE_BIN=/absolute/path/to/opencode bun script/qa/momo-native-search-install.ts` after a full build. It packs the real archive, installs it in a disposable consumer with lifecycle scripts disabled, starts real native OpenCode with isolated HOME/XDG roots, exercises search and TypeScript definition navigation, checks source freshness and runtime reuse after restart, and records cleanup. TypeScript and its language server are explicit test dependencies in that consumer; the test does not claim every language server ships with momo.

## Disabled graph candidate

`candidate.json` pins the official `codebase-memory-mcp` v0.11.0 Darwin ARM64 artifact and its upstream MIT license text by SHA-256. Explicit managed provisioning writes that exact license beside the cached binary as `LICENSE`; runtime resolution rejects a binary whose license file is missing or mismatched. It stays disabled because the fixture failed automatic freshness: after editing a source file, the new symbol was absent until a full manual reindex. The process was isolated with documented `CBM_CACHE_DIR` and `XDG_CONFIG_HOME` roots; the verified archive and cache stayed under task-specific temporary directories. No installer or global configuration was used.

The release exposes 17 MCP tools. The candidate requires `index_repository`, `search_graph`, `trace_path`, `check_index_coverage`, and `list_projects`. Its freshness tool labels coverage `best_effort`; a clean result is not proof of complete indexing, so roles must read source and verify claims when coverage is incomplete or uncertain. Large work should use async indexing and poll `index_status`; the release documents cancellation of orphaned synchronous indexing requests.

The independent fixture QA is runnable with:

```sh
bun packages/omo-opencode/src/native-search/scripts/qa-mcp-release.mjs /absolute/path/to/codebase-memory-mcp
```

It checks the MCP handshake and schemas, indexing, symbol search, caller/callee traversal, coverage metadata, parallel read queries, changed-source freshness without reindexing, manual reindex, and process reconnect. Evidence from the pinned binary is in `.omo/evidence/20261011-native-search/mcp-qa.json`; its `automaticFreshness` field is `false`. The manual full-reindex flow works. Native-role integration is still pending, so this candidate is not attached to role tool lists. The graph-only fixture does not verify the active LSP/ast-grep integration; use the archive acceptance driver above for that surface.

Official references: [v0.11.0 release](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.11.0) and [upstream tool contract](https://github.com/DeusData/codebase-memory-mcp#-mcp-tools).
