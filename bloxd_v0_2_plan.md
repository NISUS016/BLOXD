# bloxd — v0.2 Plan: Node Fix, Universal AI CLI/MCP & Obsidian Graph View

This plan builds directly on **bloxd v0.1.1** (`crates/bloxd-core` + `apps/bloxd-desktop`) and keeps overhead minimal so any AI coding agent (Claude Code, OpenCode, Antigravity, Cursor, or plain terminal agents) can map and sync repositories with zero friction.

## Architecture Addition for v0.2

```text
bloxd/
├── Cargo.toml
├── crates/
│   ├── bloxd-core/             # Existing pure Rust engine (unchanged core responsibility)
│   └── bloxd-cli/              # [NEW] Single tiny Rust binary: CLI + stdio MCP server
│       ├── src/
│       │   ├── main.rs         # clap subcommands: init, open, prompt, mcp
│       │   ├── mcp.rs          # Minimal JSON-RPC 2.0 stdio MCP server (6 tools + 1 prompt)
│       │   └── prompts.rs      # Universal "map_repo" prompt template
│       └── Cargo.toml
└── apps/
    └── bloxd-desktop/
        └── src/
            └── canvas/
                ├── BloxdNode.tsx       # [FIX] Bounded layout so Open Layer never clips
                └── ObsidianGraph.tsx   # [NEW] Force-directed HTML5 Canvas Graph View
```

## Phase 1: Fix `BloxdNode.tsx` Card Layout & Clipping

### Problem
In v0.1.1, the **Open Layer** button and badges can overflow or clip outside node boundaries when titles are long or cards are compact.

### Spec
- Refactor `apps/bloxd-desktop/src/canvas/BloxdNode.tsx` to use a strict bounded vertical flex layout (`flex flex-col overflow-hidden min-w-0`):
  - **Header row:** `kind` badge + status indicator (`min-w-0`, fixed width/no shrink on status badge).
  - **Body:** Truncated title (`line-clamp-2` or `truncate` with native `title` tooltip) and concise summary preview.
  - **Dedicated footer bar:** Separated by a subtle top border, holding child progress badge (`done/total`), `↙ N` / `↗ N` cross-layer jump pills, and the **Open Layer** button (`shrink-0`, compact padding) so nothing ever overflows the card frame.
- Ensure `computeDagreLayout` and `computeUnifiedContainerSizes` in `apps/bloxd-desktop/src/canvas/layout.ts` use node dimensions that comfortably fit the updated card height/width.

### Exit Gate
- Long node titles, child counts, external edge pills, and the **Open Layer** button all stay cleanly inside the card bounds across zoom levels (`0.4x` to `1.5x`).
- `npm run build` and `cargo build -p bloxd-desktop` pass on Windows.

## Phase 2: Universal AI CLI & `stdio` MCP Server (`crates/bloxd-cli`)

### Why One Binary (`bloxd`)?
A single lightweight Rust binary (~3–5 MB RAM, zero Node/Python runtime) works with **every** AI agent:
- **MCP-capable agents** (Claude Code, OpenCode, Antigravity, Cursor) connect via `bloxd mcp` over `stdio` for structured, schema-validated graph updates.
- **Non-MCP or terminal agents** use `.bloxd/AGENTS.md` + `bloxd prompt map` with plain file reads/writes.
- Both write through `bloxd-core` atomically, so the desktop app's `notify` watcher updates live either way.

### CLI Subcommands (`clap`)
- `bloxd init [path]` — Initializes `.bloxd/` (`graph.yaml`, `layout.json`, `AGENTS.md`, `specs/`) in `[path]` (defaults to `.`).
- `bloxd open [path]` — Initializes `.bloxd/` if needed and launches `bloxd-desktop` opened directly to `[path]` (add CLI `--open <path>` arg handling to `apps/bloxd-desktop/src-tauri/src/lib.rs`).
- `bloxd prompt map` — Prints a concise, universal instruction prompt to `stdout` that tells any AI agent how to scan the current repository and populate `.bloxd/` cleanly (nested layers, 1-hop edges, concise specs, never touching `layout.json`).
- `bloxd mcp [--project <path>]` — Starts the `stdio` MCP server scoped to `--project` (defaults to current working directory).

### Minimal `stdio` MCP Server Spec (`crates/bloxd-cli/src/mcp.rs`)
Keep dependencies light by implementing a clean, self-contained **newline-delimited JSON-RPC 2.0** loop over `stdin`/`stdout` (log errors strictly to `stderr`, never `stdout`!).

Support standard MCP lifecycle and discovery methods:
- `initialize` (returns server info + `tools` and `prompts` capabilities)
- `notifications/initialized` (no-op ack)
- `tools/list` and `tools/call`
- `prompts/list` and `prompts/get`

#### 6 Tight, Low-Token Tools

| Tool Name | Key Arguments | Behavior |
| :--- | :--- | :--- |
| `get_graph` | `parent_id?`, `status?` | Returns compact JSON summary of matching nodes and edges (keeps token usage low). |
| `get_node` | `node_id` | Returns full node fields, `specs/<node-id>.md` content, and 1-hop neighbor summaries. |
| `upsert_node` | `id`, `title`, `kind`, `parent_id?`, `status?`, `summary?`, `linked_files?`, `spec_markdown?` | Atomically creates or updates a node in `graph.yaml` and optionally writes `specs/<id>.md`. Never modifies `layout.json`. |
| `delete_node` | `node_id` | Removes node, its spec file (optional flag), and any connected edges. |
| `upsert_edge` | `source`, `target`, `label?`, `kind?` | Creates or updates a directed edge between two existing nodes. |
| `update_status` | `node_id`, `status`, `linked_files?` | Fast single-call milestone update for agents finishing or starting work. |

#### 1 Built-In MCP Prompt
- `map_repo` — Returns the same structured repository-mapping instructions as `bloxd prompt map`, guiding the agent to map top-level systems/crates/apps as root nodes, key modules inside nested layers, and cross-module data/control edges using `upsert_node` and `upsert_edge`.

### Universal Agent Registration (Zero Friction)
Once `bloxd.exe` is on your Windows `PATH`, any MCP agent registers it with one entry:

- **Claude Code:** `claude mcp add bloxd -- bloxd mcp`
- **OpenCode / Antigravity / Cursor (JSON MCP config):**

```json
{
  "mcpServers": {
    "bloxd": {
      "command": "bloxd",
      "args": ["mcp"]
    }
  }
}
```

### Exit Gate
- Unit/integration tests in `crates/bloxd-cli` verify JSON-RPC `initialize`, `tools/list`, `upsert_node`, `upsert_edge`, `update_status`, `get_graph`, and `prompts/get` over piped `stdin`/`stdout`.
- Running `bloxd open .` opens the desktop GUI directly to that repository.
- Testing `bloxd mcp` on an external project populates `.bloxd/` and refreshes the desktop app live.

## Phase 3: Obsidian-Style Force-Directed Graph View

### UX & Visual Behavior
Add a third mode to the existing view toggle: **`Nested | Unified | Graph`**.

- **Renderer:** `d3-force` simulation rendered on a high-DPI HTML5 `<canvas>` (`apps/bloxd-desktop/src/canvas/ObsidianGraph.tsx`) so hundreds of nodes stay smooth at 60–120 FPS with minimal RAM/DOM overhead.
- **Node Encoding:**
  - Displays **all nodes across all layers** as sleek circular hubs.
  - **Radius** scales gently with total degree (edges + child count), making core architectural hubs stand out immediately.
  - **Color** encodes either `status` (`planned` / `in_progress` / `blocked` / `done`) or `kind` (quick toggle in the Graph overlay).
  - Subtle dashed links connect parent → child hierarchy alongside solid links for semantic `edges` (with a toggle to show/hide hierarchy links).
- **Obsidian-Style Interactions:**
  - **Pan & Zoom:** Smooth wheel zoom toward cursor + background drag.
  - **Physics Drag:** Dragging any node pulls connected neighbors organically with damped spring forces.
  - **Hover Focus:** Hovering a node highlights that node and its 1-hop neighbors/edges at full brightness while dimming unrelated nodes to ~15% opacity and revealing clean labels.
  - **Click / Double-Click:** Single-click selects the node and opens the existing right-hand `NodeInspector`; double-click switches to **Nested** mode zoomed directly into that node's layer.
  - **Live Sync:** External `.bloxd/` updates smoothly inject/recolor nodes in the active force simulation without hard-resetting pan/zoom.

### Exit Gate
- Switching to `Graph` mode on `D:\CODING PROJECTS\bloxd` renders all nodes and connections smoothly with hover neighbor-highlighting, physics dragging, inspector selection, and double-click jump-to-layer.
- `npm run build` and `cargo build -p bloxd-desktop` pass cleanly on Windows.

## Ready-to-Paste Prompts for Your Coding Agent

### Prompt — v0.2 Phase 1 (Node Card Fix)

```text
Read `bloxd-v0.2-plan.md` and execute **Phase 1: Fix `BloxdNode.tsx` Card Layout & Clipping** only.
Refactor `BloxdNode.tsx` into a bounded flex layout with a dedicated footer bar for child badges, cross-layer pills, and the Open Layer button so nothing clips outside the node at any title length or zoom level. Update node sizing defaults in `layout.ts` if needed, then verify with `npm run build` and `cargo build -p bloxd-desktop`. Stop after Phase 1 and report results.
```

### Prompt — v0.2 Phase 2 (CLI + Universal `stdio` MCP Server)

```text
Read `bloxd-v0.2-plan.md` and execute **Phase 2: Universal AI CLI & `stdio` MCP Server (`crates/bloxd-cli`)** only.
1. Add `crates/bloxd-cli` to the Cargo workspace with `clap` subcommands: `init`, `open`, `prompt map`, and `mcp`.
2. Add `--open <path>` startup argument support to `apps/bloxd-desktop` so `bloxd open <path>` launches the GUI directly on that repo.
3. Implement a clean, minimal newline-delimited JSON-RPC 2.0 stdio MCP server in `crates/bloxd-cli/src/mcp.rs` (logging strictly to stderr) exposing the 6 tools (`get_graph`, `get_node`, `upsert_node`, `delete_node`, `upsert_edge`, `update_status`) and 1 prompt (`map_repo`) over `bloxd-core`.
4. Add automated stdin/stdout JSON-RPC tests for `crates/bloxd-cli` and verify `cargo test` and `cargo build` across the workspace. Stop after Phase 2 and report results.
```

### Prompt — v0.2 Phase 3 (Obsidian-Style Graph View)

```text
Read `bloxd-v0.2-plan.md` and execute **Phase 3: Obsidian-Style Force-Directed Graph View** only.
Add `d3-force` (and `@types/d3-force`) to `apps/bloxd-desktop`, add `Graph` as a third mode alongside `Nested` and `Unified`, and build `apps/bloxd-desktop/src/canvas/ObsidianGraph.tsx` using a high-DPI HTML5 Canvas with pan/zoom, physics node dragging, hover 1-hop neighbor highlighting, status/kind color toggle, hierarchy-link toggle, click-to-inspect, and double-click jump to Nested layer. Verify with `npm run build` and `cargo build -p bloxd-desktop`.
```
