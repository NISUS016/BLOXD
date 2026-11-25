use crate::model::{Graph, Node};
use crate::storage::{read_node_spec, BloxdError};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Compiles a compact, token-efficient Markdown context bundle scoped to `node_id`.
///
/// Includes:
/// 1. Target node metadata, linked files, and full `specs/<node-id>.md` content.
/// 2. Parent context (if nested).
/// 3. Direct 1-hop neighbors (incoming and outgoing edges).
/// 4. Child tasks/nodes (if container).
/// 5. Sync reminder for `.bloxd/graph.yaml`.
pub fn compile_node_context(
    project_dir: &Path,
    graph: &Graph,
    node_id: &str,
) -> Result<String, BloxdError> {
    let by_id: HashMap<&str, &Node> = graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let node = by_id
        .get(node_id)
        .copied()
        .ok_or_else(|| BloxdError::NotFound(format!("node '{node_id}' not found")))?;

    let mut out = String::new();
    out.push_str(&format!("# Target Node: {} (`{}`)\n\n", node.title, node.id));
    out.push_str(&format!("- **Kind:** `{:?}`\n", node.kind).to_lowercase());
    out.push_str(&format!("- **Status:** `{:?}`\n", node.status).to_lowercase());
    if !node.summary.trim().is_empty() {
        out.push_str(&format!("- **Summary:** {}\n", node.summary.trim()));
    }
    if !node.linked_files.is_empty() {
        out.push_str("- **Linked Files:**\n");
        for f in &node.linked_files {
            out.push_str(&format!("  - `{f}`\n"));
        }
    }

    let spec = read_node_spec(project_dir, node_id)?;
    if !spec.trim().is_empty() {
        out.push_str(&format!(
            "\n## Specification (`specs/{node_id}.md`)\n\n{}\n",
            spec.trim()
        ));
    }

    if let Some(parent_id) = &node.parent_id {
        if let Some(parent) = by_id.get(parent_id.as_str()) {
            out.push_str(&format!(
                "\n## Parent Context: {} (`{}`)\n\n",
                parent.title, parent.id
            ));
            if !parent.summary.trim().is_empty() {
                out.push_str(&format!("{}\n", parent.summary.trim()));
            }
        }
    }

    let incoming: Vec<_> = graph.edges.iter().filter(|e| e.target == node_id).collect();
    let outgoing: Vec<_> = graph.edges.iter().filter(|e| e.source == node_id).collect();

    if !incoming.is_empty() || !outgoing.is_empty() {
        out.push_str("\n## Direct Neighbors (1-hop)\n\n");
        let mut seen = HashSet::new();

        for edge in incoming {
            if let Some(src) = by_id.get(edge.source.as_str()) {
                let label = edge.label.as_deref().unwrap_or("connects to");
                out.push_str(&format!(
                    "- **Incoming** from **{}** (`{}`) — *{}*",
                    src.title, src.id, label
                ));
                if !src.summary.trim().is_empty() {
                    out.push_str(&format!(": {}", src.summary.trim()));
                }
                if !src.linked_files.is_empty() && seen.insert(src.id.as_str()) {
                    out.push_str(&format!(" (files: `{}`)", src.linked_files.join("`, `")));
                }
                out.push('\n');
            }
        }

        for edge in outgoing {
            if let Some(dst) = by_id.get(edge.target.as_str()) {
                let label = edge.label.as_deref().unwrap_or("connects to");
                out.push_str(&format!(
                    "- **Outgoing** to **{}** (`{}`) — *{}*",
                    dst.title, dst.id, label
                ));
                if !dst.summary.trim().is_empty() {
                    out.push_str(&format!(": {}", dst.summary.trim()));
                }
                if !dst.linked_files.is_empty() && seen.insert(dst.id.as_str()) {
                    out.push_str(&format!(" (files: `{}`)", dst.linked_files.join("`, `")));
                }
                out.push('\n');
            }
        }
    }

    let children: Vec<_> = graph
        .nodes
        .iter()
        .filter(|n| n.parent_id.as_deref() == Some(node_id))
        .collect();
    if !children.is_empty() {
        out.push_str("\n## Child Tasks\n\n");
        for child in children {
            out.push_str(&format!(
                "- `{}` **{}** (`{:?}`)\n",
                child.id, child.title, child.status
            ));
        }
    }

    out.push_str(&format!(
        "\n---\n> Sync reminder: update `{node_id}` status and `linked_files` in `.bloxd/graph.yaml` when finished.\n"
    ));

    Ok(out)
}
