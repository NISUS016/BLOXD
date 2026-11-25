# bloxd — Architecture Blueprint & v0.1 Build Plan

A local, lightweight graphical software planning and architecture canvas built for AI coding agents (Claude Code, OpenCode, Antigravity, and any file-reading agent).

## 1. Core Vision & Constraints

- **Target OS (v0.1):** Windows-first (macOS and Linux packaging deferred until public release).
- **Canvas Paradigm:** Zoomable nested layers by default (double-click any container node to drill into its sub-graph, with breadcrumb navigation and an optional unified flat view).
- **Agent Integration:** Plain-text, Git-friendly `.bloxd/` files stored inside the target repository as the single source of truth—zero runtime overhead and compatible with every coding agent out of the box.
- **Sync Model:** Periodic, milestone-based two-way sync driven by coding agents (or a cheap isolated subagent) updating semantic files while the desktop GUI watches disk changes and refreshes live.
- **Tech Stack:**
  - **Core Engine:** Pure Rust (`bloxd-core`) decoupled from the UI so a CLI, MCP server, or alternative native GUI can reuse it later.
  - **Desktop Shell:** Tauri v2 with typed Rust-to-TypeScript IPC (`tauri-specta`).
  - **Canvas Frontend:** React + TypeScript + `@xyflow/react` + Tailwind CSS + Zustand (state management).

## 2. Workspace Structure

```text
bloxd/
├── Cargo.toml                  # Rust workspace root
├── crates/
│   ├── bloxd-core/             # Pure Rust: schema, parser, file watcher, context compiler
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── model.rs        # Graph, Node, Edge, Status, Layout structs
│   │   │   ├── storage.rs      # Load/save .bloxd/graph.yaml, layout.json, specs/*.md
│   │   │   ├── watcher.rs      # Debounced file watcher (notify crate)
│   │   │   ├── context.rs      # Scoped Context Export compiler
│   │   │   └── agents_md.rs    # Auto-generates .bloxd/AGENTS.md
│   │   └── Cargo.toml
│   └── bloxd-mcp/              # [v0.2] Thin stdio MCP server wrapping bloxd-core
└── apps/
    └── bloxd-desktop/          # Tauri v2 + React + Vite + @xyflow/react
        ├── src-tauri/          # Tauri commands, event bridge, window config
        └── src/
            ├── store/          # Zustand graph + navigation + selection store
            ├── canvas/         # React Flow canvas, custom nodes, animated edges
            ├── inspector/      # Node spec Markdown editor, status controls, export button
            └── components/     # Breadcrumbs, toolbar, project picker
```

## 3. The `.bloxd/` Repository File Format

The central design rule is a **strict split between semantic truth and visual layout**. Coding agents read and edit `graph.yaml` and `specs/*.md`, and are explicitly instructed to ignore `layout.json` so they never corrupt canvas coordinates.

```text
<target-project>/
└── .bloxd/
    ├── graph.yaml              # Semantic graph (nodes, nesting, edges, statuses, file links)
    ├── layout.json             # Visual-only coordinates, colors, and saved viewports
    ├── AGENTS.md               # Auto-generated instructions for coding agents
    └── specs/
        ├── auth-service.md     # Detailed spec, prompt, and acceptance criteria per node
        └── api-gateway.md
```

### `.bloxd/graph.yaml` Schema

```yaml
version: 1
project: my-app
updated_at: "2026-11-25T18:30:00Z"

nodes:
  - id: backend
    title: Backend API
    kind: system                # system | service | module | flow_step | task | note
    parent_id: null             # null = root layer; set to parent node id for nested layers
    status: in_progress         # planned | in_progress | blocked | done
    summary: Core REST/WebSocket API layer handling auth and job orchestration.
    linked_files:
      - src/api/mod.rs
      - src/api/routes.rs
    spec_file: specs/backend.md

  - id: auth-flow
    title: JWT Auth Middleware
    kind: module
    parent_id: backend          # Lives inside the "backend" layer
    status: done
    summary: Validates bearer tokens and attaches session claims to requests.
    linked_files:
      - src/api/auth.rs
    spec_file: specs/auth-flow.md

edges:
  - id: e-gateway-auth
    source: api-gateway
    target: auth-flow
    label: verifies token
    kind: data_flow             # data_flow | dependency | sequence | triggers
```

### `.bloxd/layout.json` Schema (Ignored by Agents)

```json
{
  "version": 1,
  "nodes": {
    "backend": { "x": 120, "y": 80, "width": 260, "height": 120, "color": "#3b82f6" },
    "auth-flow": { "x": 200, "y": 140, "width": 240, "height": 110 }
  },
  "viewports": {
    "root": { "x": 0, "y": 0, "zoom": 1.0 },
    "backend": { "x": -40, "y": 20, "zoom": 1.1 }
  }
}
```

**Auto-placement rule:** Whenever an agent adds a new node to `graph.yaml` that has no entry in `layout.json`, `bloxd-app` automatically places it in a clean non-overlapping slot (e.g., via Dagre/ELK or a grid offset) and saves the new coordinate to `layout.json`.

### `.bloxd/AGENTS.md` Template (Auto-Generated)

```markdown
# bloxd Project Map Instructions

This repository uses `.bloxd/` to maintain its architecture and task plan.
- Read `.bloxd/graph.yaml` for the high-level system structure, nested layers, and node statuses.
- Read `.bloxd/specs/<node-id>.md` before implementing or modifying a component.
- Update a node's `status` (`planned` | `in_progress` | `blocked` | `done`) and `linked_files` in `.bloxd/graph.yaml` at logical milestones or after completing a task.
- NEVER modify `.bloxd/layout.json`.
```

## 4. Core v0.1 Feature Specifications

### Feature A: Zoomable Nested Canvas
- **Default Layer View:** Displays only nodes matching `current_parent_id` (starting at `null` for the root architecture view).
- **Drill-Down Navigation:** Double-clicking any node (or clicking its "Open Layer" badge) smoothly animates the viewport zoom and switches `current_parent_id` to that node's ID.
- **Breadcrumbs & Child Badges:** Top breadcrumb bar (`Root / Backend API / Auth`) allows instant jump-back; parent nodes display a compact badge showing child count and mini progress (e.g., `3/5 done`).
- **Unified View Toggle:** A toolbar toggle lets you switch between strict nested layers and a grouped overview using React Flow parent-child sub-flows.

### Feature B: Live Milestone Overlay
- **Visual Status Encoding:**
  - `planned`: Neutral slate border.
  - `in_progress`: Amber pulsing ring + subtle animated flow dashes on connected edges.
  - `blocked`: Crimson border + warning indicator.
  - `done`: Emerald border + check badge.
- **Zero-Disruption Live Refresh:** `bloxd-core` watches `.bloxd/graph.yaml` and `.bloxd/specs/` using `notify` with a 250 ms debounce. When an agent updates a file on disk, Rust emits a `bloxd://graph-updated` event to React, which reconciles node statuses, titles, and new nodes without resetting your current zoom, pan, or active layer.

### Feature C: Scoped Context Export ("Copy Node Context")
Clicking **Copy Context** on any selected node calls `bloxd-core::compile_node_context(node_id)` and copies a compact, token-efficient Markdown bundle to the clipboard containing:
1. **Target Node:** Title, kind, status, summary, linked files, and full contents of `specs/<node-id>.md`.
2. **Parent Context:** Parent node title, summary, and high-level goal (so the agent understands where this component sits).
3. **Direct Neighbors (1-hop):** Incoming and outgoing edges with neighbor titles, summaries, and linked file paths (without dumping unrelated parts of the codebase).
4. **Child Tasks (if container):** List of child node IDs, titles, and statuses.
5. **Sync Reminder:** One-line reminder to update the node's status in `.bloxd/graph.yaml` when finished.

## 5. Typed IPC Contract (`tauri-specta`)

| Direction | Name | Purpose |
| :--- | :--- | :--- |
| Command (TS → Rust) | `open_project(path: String)` | Loads `.bloxd/` (or initializes it), starts the file watcher, and returns `ProjectSnapshot`. |
| Command (TS → Rust) | `save_graph(graph: Graph)` | Atomically writes `.bloxd/graph.yaml` (write temp file + rename to avoid partial reads). |
| Command (TS → Rust) | `save_layout(layout: Layout)` | Persists `.bloxd/layout.json` on debounced drag/zoom end. |
| Command (TS → Rust) | `read_node_spec(node_id: String)` | Returns raw Markdown from `.bloxd/specs/<node-id>.md`. |
| Command (TS → Rust) | `write_node_spec(node_id: String, content: String)` | Saves updated Markdown spec to disk. |
| Command (TS → Rust) | `export_node_context(node_id: String)` | Compiles and returns the Scoped Context Export Markdown string. |
| Event (Rust → TS) | `bloxd://graph-updated` | Emitted when external edits (e.g., by an AI agent) modify `.bloxd/graph.yaml` or `specs/`. |

## 6. v0.1 Phased Build Plan (Agent-Driven)

Each phase is scoped as a self-contained agent sprint with a clear verification gate before moving to the next phase.

| Phase | Scope & Deliverables | Exit Gate (Verify Before Next Phase) |
| :--- | :--- | :--- |
| **Phase 1: Foundation & Core Engine** | Scaffold Cargo workspace (`bloxd-core` + `apps/bloxd-desktop` on Tauri v2 + React/TS/Tailwind/`@xyflow/react`/Zustand); implement and unit-test `.bloxd/` storage (`graph.yaml`, `layout.json`, `specs/*.md`, `AGENTS.md` with atomic writes); wire `tauri-specta` IPC and folder picker. | `cargo test` passes for `bloxd-core`; desktop app launches on Windows and initializes/loads `.bloxd/` in any selected folder. |
| **Phase 2: Interactive Zoomable Nested Canvas** | Build the React Flow canvas with node/edge CRUD and debounced persistence; implement default zoomable nested layers (double-click drill-down, smooth viewport zoom transitions, breadcrumb bar, child progress badges) plus unified flat-view toggle. | You can build a 2+ level nested architecture graph, restart the app, and restore both graph structure and exact layout coordinates. |
| **Phase 3: Node Inspector & Live Milestone Overlay** | Add the right-hand inspector drawer (kind, status, `linked_files`, Markdown spec editor for `specs/<node-id>.md`); add debounced `notify` file watcher emitting `bloxd://graph-updated`; render status rings, animated `in_progress` edges, and auto-placement for agent-added nodes. | Editing `graph.yaml` externally (or via an agent) updates node statuses and places newly added nodes live without resetting camera pan/zoom. |
| **Phase 4: Scoped Context Export** | Implement `bloxd-core::compile_node_context(node_id)` (target spec + parent context + 1-hop neighbors + child statuses + sync reminder) and wire the toolbar/inspector "Copy Context" button and clipboard toast. | Clicking "Copy Context" on any node copies a clean, token-efficient Markdown bundle scoped strictly to that node and its immediate neighborhood. |
| **Phase 5: Polish, Shortcuts & Agent Dogfooding** | Refine dark-mode styling and micro-animations; add `Ctrl+K` quick-add/jump command palette, `Backspace` to ascend a layer, and `Ctrl+Shift+C` context export shortcut; dogfood the full loop with Claude Code/OpenCode on a real mini-project. | End-to-end loop (plan visually → export scoped context → agent codes & updates `.bloxd/` → canvas reflects live progress) runs smoothly on Windows. |

## 7. v0.2+ Roadmap (Deferred Until v0.1 Ships)

- **`bloxd-mcp` (`stdio` MCP Server):** 6 tight tools (`get_graph`, `get_node`, `update_status`, `add_node`, `link_nodes`, `log_decision`) compiled as a tiny standalone Rust binary (~3–5 MB RAM) over `bloxd-core`.
- **Code-Linked Git Drift Badges:** Compare `linked_files` globs against `git diff` since the last sync timestamp; surface a subtle "Needs Sync" badge on drifted nodes and trigger a cheap subagent (`bloxd sync <node-id>`) only for affected nodes.
- **Cross-Platform Builds:** Add macOS and Linux CI builds and installers if releasing publicly.

## 8. Starter Prompt for Phase 1 (Claude Code / OpenCode / Antigravity)

```text
Read `bloxd-blueprint.md` in the repository root. We are building **bloxd** (Windows-first, Tauri v2 + decoupled Rust core `bloxd-core` + React/TypeScript/`@xyflow/react`/Tailwind).

Execute **Phase 1: Foundation & Core Engine** only:
1. Initialize the Cargo workspace with `crates/bloxd-core` (library crate) and `apps/bloxd-desktop` (Tauri v2 + Vite + React + TypeScript + Tailwind CSS + `@xyflow/react` + Zustand).
2. Implement `bloxd-core` models (`Graph`, `Node`, `Edge`, `Status`, `Layout`), atomic read/write storage for `.bloxd/graph.yaml`, `.bloxd/layout.json`, `.bloxd/specs/<node-id>.md`, and `.bloxd/AGENTS.md` generation, with unit tests.
3. Wire typed `tauri-specta` IPC commands (`open_project`, `save_graph`, `save_layout`, `read_node_spec`, `write_node_spec`, `export_node_context` stub) and a minimal dark-mode shell with a folder picker to open or initialize `.bloxd/`.
4. Verify the Phase 1 Exit Gate: `cargo test` passes and the Tauri app compiles and launches cleanly on Windows.

Stop after Phase 1 and summarize verification results before moving to Phase 2.
```