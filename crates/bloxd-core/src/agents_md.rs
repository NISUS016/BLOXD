/// Returns the default `.bloxd/AGENTS.md` instructions for coding agents.
pub fn generate_agents_md() -> &'static str {
    r#"# bloxd Project Map Instructions

This repository uses `.bloxd/` to maintain its architecture and task plan.
- Read `.bloxd/graph.yaml` for the high-level system structure, nested layers, and node statuses.
- Read `.bloxd/specs/<node-id>.md` before implementing or modifying a component.
- Update a node's `status` (`planned` | `in_progress` | `blocked` | `done`) and `linked_files` in `.bloxd/graph.yaml` at logical milestones or after completing a task.
- NEVER modify `.bloxd/layout.json`.
"#
}
