use crate::agents_md::generate_agents_md;
use crate::model::{ChecklistProgress, Graph, Layout, NodeLayout, ProjectSnapshot};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use thiserror::Error;

const BLOXD_DIR: &str = ".bloxd";
const GRAPH_FILE: &str = "graph.yaml";
const LAYOUT_FILE: &str = "layout.json";
const AGENTS_FILE: &str = "AGENTS.md";
const SPECS_DIR: &str = "specs";

/// Errors returned by `.bloxd/` storage operations.
#[derive(Debug, Error)]
pub enum BloxdError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("YAML serialization error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid node id: {0}")]
    InvalidNodeId(String),
    #[error("not found: {0}")]
    NotFound(String),
}

fn bloxd_dir(project_dir: &Path) -> PathBuf {
    project_dir.join(BLOXD_DIR)
}

fn specs_dir(project_dir: &Path) -> PathBuf {
    bloxd_dir(project_dir).join(SPECS_DIR)
}

/// Validates that `node_id` is a safe single-segment filename stem (no path traversal).
fn validate_node_id(node_id: &str) -> Result<(), BloxdError> {
    if node_id.is_empty()
        || node_id == "."
        || node_id == ".."
        || node_id.contains('/')
        || node_id.contains('\\')
        || node_id.contains('\0')
    {
        return Err(BloxdError::InvalidNodeId(node_id.to_string()));
    }
    Ok(())
}

/// Atomically writes `bytes` to `target` by creating a temporary file in the same directory and persisting it.
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), BloxdError> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent dir")
    })?;
    fs::create_dir_all(parent)?;

    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

/// Opens an existing `.bloxd/` directory or initializes a new one inside `project_dir`.
pub fn init_or_open_project(project_dir: &Path) -> Result<ProjectSnapshot, BloxdError> {
    if !project_dir.exists() {
        return Err(BloxdError::NotFound(format!(
            "project directory does not exist: {}",
            project_dir.display()
        )));
    }

    let root = bloxd_dir(project_dir);
    fs::create_dir_all(specs_dir(project_dir))?;

    let graph_path = root.join(GRAPH_FILE);
    let graph = if graph_path.exists() {
        load_graph(project_dir)?
    } else {
        let project_name = project_dir
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("bloxd-project");
        let g = Graph::new(project_name);
        save_graph(project_dir, &g)?;
        g
    };

    let layout_path = root.join(LAYOUT_FILE);
    let layout = if layout_path.exists() {
        load_layout(project_dir)?
    } else {
        let l = Layout::default();
        save_layout(project_dir, &l)?;
        l
    };

    let agents_path = root.join(AGENTS_FILE);
    if !agents_path.exists() {
        atomic_write(&agents_path, generate_agents_md().as_bytes())?;
    }

    let checklists = compute_project_checklists(project_dir, &graph);

    Ok(ProjectSnapshot {
        project_path: project_dir.to_string_lossy().into_owned(),
        graph,
        layout,
        checklists,
    })
}

/// Loads `.bloxd/graph.yaml` from `project_dir`.
pub fn load_graph(project_dir: &Path) -> Result<Graph, BloxdError> {
    let raw = fs::read_to_string(bloxd_dir(project_dir).join(GRAPH_FILE))?;
    Ok(serde_yaml::from_str(&raw)?)
}

/// Atomically writes `graph` to `.bloxd/graph.yaml`.
pub fn save_graph(project_dir: &Path, graph: &Graph) -> Result<(), BloxdError> {
    let yaml = serde_yaml::to_string(graph)?;
    atomic_write(&bloxd_dir(project_dir).join(GRAPH_FILE), yaml.as_bytes())
}

/// Loads `.bloxd/layout.json` from `project_dir`.
pub fn load_layout(project_dir: &Path) -> Result<Layout, BloxdError> {
    let raw = fs::read_to_string(bloxd_dir(project_dir).join(LAYOUT_FILE))?;
    Ok(serde_json::from_str(&raw)?)
}

/// Atomically writes `layout` to `.bloxd/layout.json`.
pub fn save_layout(project_dir: &Path, layout: &Layout) -> Result<(), BloxdError> {
    let json = serde_json::to_string_pretty(layout)?;
    atomic_write(&bloxd_dir(project_dir).join(LAYOUT_FILE), json.as_bytes())
}

/// Reads `.bloxd/specs/<node_id>.md`, returning an empty string if the spec file does not exist yet.
pub fn read_node_spec(project_dir: &Path, node_id: &str) -> Result<String, BloxdError> {
    validate_node_id(node_id)?;
    let path = specs_dir(project_dir).join(format!("{node_id}.md"));
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(BloxdError::Io(e)),
    }
}

/// Atomically writes `content` to `.bloxd/specs/<node_id>.md`.
pub fn write_node_spec(
    project_dir: &Path,
    node_id: &str,
    content: &str,
) -> Result<(), BloxdError> {
    validate_node_id(node_id)?;
    let path = specs_dir(project_dir).join(format!("{node_id}.md"));
    atomic_write(&path, content.as_bytes())
}

/// Places any nodes missing from `nodes_map` at non-overlapping sibling slots.
fn place_missing_in_map(
    graph: &Graph,
    nodes_map: &mut BTreeMap<String, NodeLayout>,
) -> bool {
    let mut changed = false;

    for node in &graph.nodes {
        if nodes_map.contains_key(&node.id) {
            continue;
        }

        let sibling_positions: Vec<&NodeLayout> = graph
            .nodes
            .iter()
            .filter(|other| other.parent_id == node.parent_id && other.id != node.id)
            .filter_map(|other| nodes_map.get(&other.id))
            .collect();

        let idx = sibling_positions.len();
        let mut x = 80.0 + ((idx % 3) as f64) * 320.0;
        let mut y = if node.parent_id.is_some() { 112.0 } else { 80.0 } + ((idx / 3) as f64) * 180.0;

        while sibling_positions
            .iter()
            .any(|p| (p.x - x).abs() < 250.0 && (p.y - y).abs() < 130.0)
        {
            x += 40.0;
            y += 40.0;
        }

        nodes_map.insert(
            node.id.clone(),
            NodeLayout {
                x,
                y,
                width: 260.0,
                height: 136.0,
                color: None,
            },
        );
        changed = true;
    }

    changed
}

/// Assigns clean non-overlapping coordinates in `layout` for any nodes in `graph` missing a layout entry.
/// When `layout.unified_nodes` is already initialized, also places missing nodes incrementally there.
///
/// Returns `true` if `layout` was modified.
pub fn auto_place_missing_nodes(graph: &Graph, layout: &mut Layout) -> bool {
    let mut changed = place_missing_in_map(graph, &mut layout.nodes);
    if !layout.unified_nodes.is_empty() && place_missing_in_map(graph, &mut layout.unified_nodes) {
        changed = true;
    }
    changed
}

fn prune_layout_for_removed(
    layout: &mut Layout,
    removed_nodes: &std::collections::HashSet<String>,
    removed_edges: &std::collections::HashSet<String>,
) {
    for nid in removed_nodes {
        layout.nodes.remove(nid);
        layout.unified_nodes.remove(nid);
    }
    let prune_map = |map: &mut BTreeMap<String, _>| {
        map.retain(|k, _| {
            if removed_edges.contains(k) {
                return false;
            }
            if let Some(rest) = k.strip_prefix("rollup-") {
                if let Some((src, dst)) = rest.split_once("->") {
                    if removed_nodes.contains(src) || removed_nodes.contains(dst) {
                        return false;
                    }
                }
            }
            true
        });
    };
    prune_map(&mut layout.edge_labels);
    prune_map(&mut layout.unified_edge_labels);
    // Prune edge_routes and unified_edge_routes separately (distinct value types)
    layout.edge_routes.retain(|k, _| {
        if removed_edges.contains(k) {
            return false;
        }
        if let Some(rest) = k.strip_prefix("rollup-") {
            if let Some((src, dst)) = rest.split_once("->") {
                if removed_nodes.contains(src) || removed_nodes.contains(dst) {
                    return false;
                }
            }
        }
        true
    });
    layout.unified_edge_routes.retain(|k, _| {
        if removed_edges.contains(k) {
            return false;
        }
        if let Some(rest) = k.strip_prefix("rollup-") {
            if let Some((src, dst)) = rest.split_once("->") {
                if removed_nodes.contains(src) || removed_nodes.contains(dst) {
                    return false;
                }
            }
        }
        true
    });
}

fn collect_descendant_ids(graph: &Graph, root_id: &str) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::from([root_id.to_string()]);
    let mut added = true;
    while added {
        added = false;
        for n in &graph.nodes {
            if let Some(pid) = &n.parent_id {
                if set.contains(pid) && set.insert(n.id.clone()) {
                    added = true;
                }
            }
        }
    }
    set
}

/// Accepts a single proposed node (`proposed = false`, clears `proposal_note`).
pub fn accept_node_proposal(graph: &mut Graph, node_id: &str) -> bool {
    if let Some(node) = graph.nodes.iter_mut().find(|n| n.id == node_id && n.proposed) {
        node.proposed = false;
        node.proposal_note = None;
        return true;
    }
    false
}

/// Rejects a single proposed node (and its descendants + connected edges), pruning layout if provided.
pub fn reject_node_proposal(
    graph: &mut Graph,
    layout: Option<&mut Layout>,
    node_id: &str,
) -> bool {
    if !graph.nodes.iter().any(|n| n.id == node_id && n.proposed) {
        return false;
    }
    let to_remove = collect_descendant_ids(graph, node_id);
    let mut removed_edges = std::collections::HashSet::new();
    graph.edges.retain(|e| {
        let drop = to_remove.contains(&e.source) || to_remove.contains(&e.target);
        if drop {
            removed_edges.insert(e.id.clone());
        }
        !drop
    });
    graph.nodes.retain(|n| !to_remove.contains(&n.id));
    if let Some(l) = layout {
        prune_layout_for_removed(l, &to_remove, &removed_edges);
    }
    true
}

/// Accepts a single proposed edge (`proposed = false`, clears `proposal_note`).
pub fn accept_edge_proposal(graph: &mut Graph, edge_id: &str) -> bool {
    if let Some(edge) = graph.edges.iter_mut().find(|e| e.id == edge_id && e.proposed) {
        edge.proposed = false;
        edge.proposal_note = None;
        return true;
    }
    false
}

/// Rejects a single proposed edge, pruning route/label layout entries if provided.
pub fn reject_edge_proposal(
    graph: &mut Graph,
    layout: Option<&mut Layout>,
    edge_id: &str,
) -> bool {
    let before = graph.edges.len();
    graph.edges.retain(|e| !(e.id == edge_id && e.proposed));
    if graph.edges.len() == before {
        return false;
    }
    if let Some(l) = layout {
        let empty_nodes = std::collections::HashSet::new();
        let removed_edges = std::collections::HashSet::from([edge_id.to_string()]);
        prune_layout_for_removed(l, &empty_nodes, &removed_edges);
    }
    true
}

/// Accepts all proposed nodes and edges in `graph`, returning the number promoted.
pub fn accept_all_proposals(graph: &mut Graph) -> usize {
    let mut count = 0;
    for n in &mut graph.nodes {
        if n.proposed {
            n.proposed = false;
            n.proposal_note = None;
            count += 1;
        }
    }
    for e in &mut graph.edges {
        if e.proposed {
            e.proposed = false;
            e.proposal_note = None;
            count += 1;
        }
    }
    count
}

/// Rejects all proposed nodes (deleting dangling edges) and proposed edges, returning items removed.
pub fn reject_all_proposals(graph: &mut Graph, layout: Option<&mut Layout>) -> usize {
    let proposed_roots: Vec<String> = graph
        .nodes
        .iter()
        .filter(|n| n.proposed)
        .map(|n| n.id.clone())
        .collect();
    let mut removed_nodes = std::collections::HashSet::new();
    for nid in &proposed_roots {
        removed_nodes.extend(collect_descendant_ids(graph, nid));
    }

    let before_nodes = graph.nodes.len();
    graph.nodes.retain(|n| !removed_nodes.contains(&n.id));
    let removed_node_count = before_nodes - graph.nodes.len();

    let mut removed_edges = std::collections::HashSet::new();
    let before_edges = graph.edges.len();
    graph.edges.retain(|e| {
        let drop = e.proposed || removed_nodes.contains(&e.source) || removed_nodes.contains(&e.target);
        if drop {
            removed_edges.insert(e.id.clone());
        }
        !drop
    });
    let removed_edge_count = before_edges - graph.edges.len();

    if let Some(l) = layout {
        prune_layout_for_removed(l, &removed_nodes, &removed_edges);
    }

    removed_node_count + removed_edge_count
}

/// Parses Markdown task list items (`- [ ] `, `- [x] `, `- [X] `) from `markdown`.
pub fn parse_checklist_progress(markdown: &str) -> ChecklistProgress {
    let mut done = 0u32;
    let mut total = 0u32;

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        let rest = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "));
        if let Some(body) = rest {
            if body.starts_with("[ ] ") || body == "[ ]" {
                total += 1;
            } else if body.starts_with("[x] ")
                || body.starts_with("[X] ")
                || body == "[x]"
                || body == "[X]"
            {
                total += 1;
                done += 1;
            }
        }
    }

    ChecklistProgress { done, total }
}

/// Computes checklist progress for every node in `graph` that has task items in `specs/<id>.md`.
pub fn compute_project_checklists(
    project_dir: &Path,
    graph: &Graph,
) -> BTreeMap<String, ChecklistProgress> {
    let mut map = BTreeMap::new();
    for node in &graph.nodes {
        if let Ok(spec) = read_node_spec(project_dir, &node.id) {
            let progress = parse_checklist_progress(&spec);
            if progress.total > 0 {
                map.insert(node.id.clone(), progress);
            }
        }
    }
    map
}
