# bloxd — Master Project State

> Single source of truth for all planning chats and coding agents. Keep this file concise (~80–100 lines) and update it before committing major changes.

## 1. Vision & Core Goals

- **bloxd** (`D:\CODING PROJECTS\bloxd`) is a local, low-RAM graphical software planning and architecture canvas built to work natively with any AI coding agent (Claude Code, OpenCode, Antigravity, Cursor, or terminal agents).
- **Source of truth:** Repo-local `.bloxd/` files (`graph.yaml` + `specs/*.md` for agent-editable semantics; `layout.json` visual-only, never edited by agents; auto-generated `AGENTS.md`).
- **Sync model:** Periodic/milestone two-way sync via `.bloxd/` files and `bloxd mcp`, with live debounced GUI refresh.

## 2. Locked Stack & Non-Negotiable Constraints

- **Target OS:** Windows-first (macOS/Linux packaging deferred unless released publicly).
- **Workspace:**
  - `crates/bloxd-core` — Pure Rust `.bloxd/` schema, atomic storage (`NamedTempFile::persist`), 250 ms debounced `notify` watcher (3×50 ms Windows lock retry), Git drift engine, and scoped context compiler.
  - `crates/bloxd-cli` — Single Rust binary (`init`, `open`, `prompt map`, `mcp` JSON-RPC 2.0 stdio server). Installed globally to `C:\Users\NISHCHAL\.cargo\bin\bloxd.exe` and registered in Antigravity (`~/.gemini/config/mcp_config.json`).
  - `apps/bloxd-desktop` — Tauri v2 + `tauri-specta` typed IPC + React, TypeScript, `@xyflow/react`, `elkjs` (primary layout engine; `@dagrejs/dagre` kept temporarily pending cleanup), `d3-force`, Tailwind CSS, Zustand.
- **Disk & build hygiene:** `[profile.dev.package."*"] debug = 0` in root `Cargo.toml`; `apps/bloxd-desktop/pnpm-workspace.yaml` sets `allowBuilds: { esbuild: true }` for pnpm v11.
- **Intentionally deferred:** Visual/aesthetic theme overhaul ("AI vibecoded" look) is parked until core features are mature.

## 3. Shipped Capabilities

- **v0.1 – v0.1.1 (Core Canvas & Storage):** Zoomable nested layers (default) + Unified view with post-order container sizing, LR/TB auto-layout, live milestone overlay (`planned` / `in_progress` / `blocked` / `done`), node inspector + Markdown spec editor, `Ctrl+K` command palette, `Backspace` ascend, `Ctrl+Shift+C` Scoped Context Export, and `↙ N` / `↗ N` cross-layer jump pills.
- **v0.2 + UX Polish (`6c56a57`, `131e76e`, `fca7a21`):**
  - Global `bloxd` CLI + stdio MCP server (`get_graph`, `get_node`, `upsert_node`, `delete_node`, `upsert_edge`, `update_status`, `map_repo` prompt).
  - Obsidian-style HTML5 Canvas Graph view (`d3-force`, 1-hop hover highlight, Status/Kind color toggle, Hierarchy toggle, Timelapse replay, Gravity slider).
  - Bounded `BloxdNode` cards with `NodeResizer`, double-click inspector, 4-way handles, rolled-up cross-layer edges in Nested view, draggable wire-snapped labels, and 20 px Snap-to-Grid.
- **v0.3 + Layout & Routing Upgrade (`a0f736b` on `main`):**
  - `Mouse4`/`Mouse5` + `Alt+Left`/`Alt+Right` layer history navigation and 50-step `Ctrl+Z` / `Ctrl+Shift+Z` Undo/Redo stack.
  - Live Markdown checklists (`- [ ]` / `- [x]`) and constraints (ADRs) per node.
  - Multi-node / feature-slice deduplicated Context Export (`Ctrl+Shift+C`).
  - Zero-token Git Drift Detection (`Δ N` badges, `get_drifted_nodes` / `mark_synced` MCP tools, "Copy Sync Prompt").
  - Wire routing settings (`90° Rounded` default, `45° Circuit`, `Smooth Bézier`) in bottom-left React Flow Controls; uniform-height toolbar (`h-7`).

## 4. Recent Fixes & Current Repo Delta

- **Latest pushed code commit:** `a0f736b` on `main` (pushed to `origin/main`; `feat/elk-layout` safety branch at `38c0963` merged cleanly).
- **ELK Hybrid Layout & Collision-Free Routing:** Replaced Dagre with `elkjs` (`computeElkLayout` for Nested, `computeElkHierarchicalLayout` with `INCLUDE_CHILDREN` for Unified), fixed explicit `undefined` keys on `ElkNode` that triggered ELK's GWT fallback crash, made `computeFallbackGridLayout` size-aware, and handled all 16 handle pairs in `buildRoundedOrthoPath` + pure 45° `buildCircuitPath`.
- **Separated Nested vs. Unified State:** Added backward-compatible `unified_nodes`, `unified_edge_labels`, `edge_routes`, and `unified_edge_routes` to Rust `Layout` & `bindings.ts`; Unified switches no longer overwrite Nested coordinates.
- **Selective Drag Invalidation & Port Dots:** Auto-Layout stores ELK world-space polylines/labels; manually moving/resizing a node invalidates only connected routes so they fall back cleanly to the dynamic pill-collision solver. Added colored SVG start port dots (`BloxdEdge.tsx`) at wire origins.
- **Note:** Keep `@dagrejs/dagre` cleanup & installing refreshed `bloxd.exe` release binary in mind if needed after Rust updates.

## 5. Active Planning Thread (v0.4 — AI ↔ App Interaction)

Bridging from copy-paste/silent-overwrite to a live collaborative workspace (decisions pending):
- **Ghost-Node Proposals:** Translucent proposed nodes/edges via MCP (`propose_node` / `propose_edge`) with Accept/Reject controls.
- **Live Agent Presence & Activity Feed:** Ephemeral `.bloxd/.agent-state.json` beacon showing active agent node + slim activity log.
- **Direct Task Dispatch / Agent Queue:** Queuing tasks from `bloxd` for MCP agents (`get_next_task`) or configurable local CLI triggers per node.
- **Moodboard Nodes:** Freeform sticky notes + pasted reference images (`.bloxd/assets/`) agents can crystallize into Ghost-Node proposals.

## 6. Long-Term Vision Parking Lot

- **Near-Realtime Code-to-Graph Sync (v0.5):** Lightweight Tree-sitter or commit-hook automation to keep modules and edges synced as code changes.
- **Visual & Design-System Overhaul (v0.5+):** Dedicated typography, surface hierarchy, and theme pass once core features are proven.
- **Public / Open-Source Release (Future):** Cross-platform builds + naming check (`bloxd.io` exists as a browser game).

## 7. Maintenance Rule for Coding Agents

Before committing and pushing any feature or bug fix, update Sections 3–4 of `PROJECT_STATE.md` (and `.bloxd/graph.yaml` / `specs/` if architecture changed) while keeping this file concise (~80–100 lines).
