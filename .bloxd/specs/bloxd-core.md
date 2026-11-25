# bloxd-core Engine

Pure Rust library crate decoupled from Tauri so CLI, MCP, or other frontends can reuse `.bloxd/` operations.

## Responsibilities
- Typed YAML/JSON schemas (`Graph`, `Layout`, `ProjectSnapshot`)
- Atomic disk persistence (temp file + `persist`)
- 250 ms debounced filesystem watcher (`notify`)
- Scoped Markdown context compiler
