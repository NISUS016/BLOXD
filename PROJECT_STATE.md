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
  - `apps/bloxd-desktop` — Tauri v2 + `tauri-specta` typed IPC + React, TypeScript, `@xyflow/react`, `elkjs` (primary hierarchical & orthogonal layout engine), `d3-force`, Tailwind CSS, Zustand.
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

- **v0.4 Phase 1 (Ghost-Node Proposals + Cleanup — shipped on `main`):**
  - Removed unused `@dagrejs/dagre`; kept `elkjs` + `computeFallbackGridLayout`.
  - Added `proposed` + `proposal_note` on `Node`/`Edge`, `bloxd-core` accept/reject helpers + incremental `unified_nodes` placement, `propose_node` & `propose_edge` MCP tools (`10` tools total), translucent dashed Ghost-Node/Edge UI with inline ✓/✕ actions, and floating `Accept All | Reject All` bar.

## 4. Recent Fixes & Current Repo Delta

- **Latest base commits on `main`:** `85e9b8c` (`a0f736b` ELK layout + `PROJECT_STATE.md`), followed by v0.4 Phase 1.
- **ELK Hybrid Layout & Collision-Free Routing (`a0f736b`):** `elkjs` (`computeElkLayout` for Nested, `computeElkHierarchicalLayout` for Unified), separated `unified_nodes` / `unified_edge_routes` / `edge_routes` state, selective route invalidation on node move/resize, all-16-pair `buildRoundedOrthoPath` + pure 45° `buildCircuitPath`, and colored wire start port dots.
- **v0.4 Phase 1 Delta:** Ghost-Node Proposals across `bloxd-core`, `bloxd-cli`, and `bloxd-desktop` + `@dagrejs/dagre` removal (`cargo test --workspace`, `pnpm build`, `cargo build -p bloxd-desktop` passing); global `bloxd.exe` reinstall deferred until after Phase 4.

## 5. Active Planning Thread (v0.4 — AI ↔ App Interaction)

Remaining phases in `bloxd_v0_4_plan.md` (Phase 1 complete):
- **Phase 2 — Live Agent Presence & Activity Feed:** Ephemeral `.bloxd/.agent-state.json` beacon + typed `watcher.rs` events + bottom-right Activity feed.
- **Phase 3 — Direct Task Dispatch & Agent Queue:** `.bloxd/queue.yaml`, `get_next_task`/`claim_task`/`complete_task` MCP tools, `queue.yaml` watcher, and temp-file Windows CLI runner.
- **Phase 4 — Moodboard Nodes & Crystallize Workflow:** Sticky notes + `Ctrl+V`/dropped assets under `.bloxd/assets/`, and `crystallize_moodboard` → Ghost-Node proposals.

## 6. Long-Term Vision Parking Lot

- **Near-Realtime Code-to-Graph Sync (v0.5):** Lightweight Tree-sitter or commit-hook automation to keep modules and edges synced as code changes.
- **Visual & Design-System Overhaul (v0.5+):** Dedicated typography, surface hierarchy, and theme pass once core features are proven.
- **Public / Open-Source Release (Future):** Cross-platform builds + naming check (`bloxd.io` exists as a browser game).

## 7. Maintenance Rule for Coding Agents

Before committing and pushing any feature or bug fix, update Sections 3–4 of `PROJECT_STATE.md` (and `.bloxd/graph.yaml` / `specs/` if architecture changed) while keeping this file concise (~80–100 lines).
