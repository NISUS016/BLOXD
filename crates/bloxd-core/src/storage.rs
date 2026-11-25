use crate::agents_md::generate_agents_md;
use crate::model::{Graph, Layout, NodeLayout, ProjectSnapshot};
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

    Ok(ProjectSnapshot {
        project_path: project_dir.to_string_lossy().into_owned(),
        graph,
        layout,
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

/// Assigns clean non-overlapping coordinates in `layout` for any nodes in `graph` missing a layout entry.
///
/// Returns `true` if `layout` was modified.
pub fn auto_place_missing_nodes(graph: &Graph, layout: &mut Layout) -> bool {
    let mut changed = false;

    for node in &graph.nodes {
        if layout.nodes.contains_key(&node.id) {
            continue;
        }

        let sibling_positions: Vec<&NodeLayout> = graph
            .nodes
            .iter()
            .filter(|other| other.parent_id == node.parent_id && other.id != node.id)
            .filter_map(|other| layout.nodes.get(&other.id))
            .collect();

        let idx = sibling_positions.len();
        let mut x = 80.0 + ((idx % 3) as f64) * 300.0;
        let mut y = 80.0 + ((idx / 3) as f64) * 170.0;

        while sibling_positions
            .iter()
            .any(|p| (p.x - x).abs() < 250.0 && (p.y - y).abs() < 130.0)
        {
            x += 40.0;
            y += 40.0;
        }

        layout.nodes.insert(
            node.id.clone(),
            NodeLayout {
                x,
                y,
                width: 240.0,
                height: 110.0,
                color: None,
            },
        );
        changed = true;
    }

    changed
}
