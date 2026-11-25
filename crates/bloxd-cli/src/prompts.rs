/// Universal repository-mapping prompt for AI coding agents.
pub const MAP_REPO_PROMPT: &str = r#"Map this repository into `.bloxd/` using bloxd's nested architecture format:

1. Scan the repository structure (crates, apps, services, packages, and key modules).
2. Create root nodes (`parent_id: null`, `kind: system` or `service`) for top-level subsystems.
3. Create child module/task nodes (`parent_id: <root-id>`, `kind: module` or `task`) for important components inside each subsystem.
4. Add directed 1-hop `edges` (`data_flow`, `dependency`, `sequence`, `triggers`) between modules—including cross-layer edges where subsystems interact.
5. Set accurate `status` (`planned` | `in_progress` | `blocked` | `done`), `linked_files`, and concise `specs/<node-id>.md` files.
6. If using the `bloxd` MCP server, call `upsert_node` and `upsert_edge`. If editing files directly, follow `.bloxd/AGENTS.md` and NEVER modify `.bloxd/layout.json`."#;
