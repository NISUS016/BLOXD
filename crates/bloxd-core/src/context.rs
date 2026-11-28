use crate::model::{Graph, Node};
use crate::storage::{read_node_spec, BloxdError};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Compiles a compact, token-efficient Markdown context bundle scoped to `node_id`.
///
/// Includes:
/// 1. Target node metadata, linked files, constraints/ADRs, and full `specs/<node-id>.md` content.
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

    if !node.constraints.is_empty() {
        out.push_str("\n## Constraints & Decisions (Do Not Violate)\n\n");
        for c in &node.constraints {
            out.push_str(&format!("- {c}\n"));
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

fn layer_path(by_id: &HashMap<&str, &Node>, node: &Node) -> String {
    let mut parts = Vec::new();
    let mut cur = node.parent_id.as_deref();
    let mut guard = HashSet::new();
    while let Some(pid) = cur {
        if !guard.insert(pid) {
            break;
        }
        if let Some(p) = by_id.get(pid) {
            parts.push(p.title.as_str());
            cur = p.parent_id.as_deref();
        } else {
            break;
        }
    }
    if parts.is_empty() {
        "Root".to_string()
    } else {
        parts.reverse();
        format!("Root / {}", parts.join(" / "))
    }
}

/// Compiles a deduplicated Markdown context bundle for a selected slice of nodes.
pub fn compile_multi_node_context(
    project_dir: &Path,
    graph: &Graph,
    node_ids: &[String],
) -> Result<String, BloxdError> {
    if node_ids.is_empty() {
        return Err(BloxdError::NotFound("no node IDs provided".to_string()));
    }

    let by_id: HashMap<&str, &Node> = graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut unique_ids = Vec::new();
    let mut selected_set = HashSet::new();

    for id in node_ids {
        if !by_id.contains_key(id.as_str()) {
            return Err(BloxdError::NotFound(format!("node '{id}' not found")));
        }
        if selected_set.insert(id.as_str()) {
            unique_ids.push(id.as_str());
        }
    }

    let mut out = String::new();
    out.push_str(&format!(
        "# Feature Slice Context ({} nodes)\n\n",
        unique_ids.len()
    ));

    out.push_str("## Selected Slice Overview\n\n");
    for id in &unique_ids {
        let n = by_id[id];
        out.push_str(&format!(
            "- **{}** (`{}`) — `{:?}` · {}\n",
            n.title,
            n.id,
            n.status,
            layer_path(&by_id, n)
        ));
    }

    let internal_edges: Vec<_> = graph
        .edges
        .iter()
        .filter(|e| selected_set.contains(e.source.as_str()) && selected_set.contains(e.target.as_str()))
        .collect();
    if !internal_edges.is_empty() {
        out.push_str("\n### Internal Slice Connections\n\n");
        for e in internal_edges {
            let label = e.label.as_deref().unwrap_or("connects to");
            out.push_str(&format!("- `{}` → `{}` (*{}*)\n", e.source, e.target, label));
        }
    }

    out.push_str("\n## Selected Node Specs & Constraints\n");
    for id in &unique_ids {
        let n = by_id[id];
        out.push_str(&format!("\n### {} (`{}`)\n\n", n.title, n.id));
        if !n.summary.trim().is_empty() {
            out.push_str(&format!("{}\n\n", n.summary.trim()));
        }
        if !n.linked_files.is_empty() {
            out.push_str("**Linked Files:** ");
            out.push_str(
                &n.linked_files
                    .iter()
                    .map(|f| format!("`{f}`"))
                    .collect::<Vec<_>>()
                    .join(", "),
            );
            out.push_str("\n\n");
        }
        if !n.constraints.is_empty() {
            out.push_str("**Constraints & Decisions (Do Not Violate):**\n");
            for c in &n.constraints {
                out.push_str(&format!("- {c}\n"));
            }
            out.push('\n');
        }
        let spec = read_node_spec(project_dir, id)?;
        if !spec.trim().is_empty() {
            out.push_str(&format!("```markdown\n{}\n```\n", spec.trim()));
        }
    }

    // Deduplicated 1-hop boundary neighbors outside the selected slice
    let mut boundary_seen = HashSet::new();
    let mut boundary_lines = Vec::new();

    for e in &graph.edges {
        let src_in = selected_set.contains(e.source.as_str());
        let dst_in = selected_set.contains(e.target.as_str());
        if src_in == dst_in {
            continue;
        }
        let external_id = if src_in { e.target.as_str() } else { e.source.as_str() };
        if boundary_seen.insert(external_id) {
            if let Some(ext) = by_id.get(external_id) {
                let files = if ext.linked_files.is_empty() {
                    String::new()
                } else {
                    format!(" (files: `{}`)", ext.linked_files.join("`, `"))
                };
                boundary_lines.push(format!(
                    "- **{}** (`{}`): {}{}",
                    ext.title,
                    ext.id,
                    ext.summary.trim(),
                    files
                ));
            }
        }
    }

    if !boundary_lines.is_empty() {
        out.push_str("\n## Boundary Neighbors (1-hop, Deduplicated)\n\n");
        for line in boundary_lines {
            out.push_str(&line);
            out.push('\n');
        }
    }

    out.push_str(
        "\n---\n> Sync reminder: update statuses, `linked_files`, and checklists in `.bloxd/` via `bloxd mcp` or direct file edits when finished.\n",
    );

    Ok(out)
}
