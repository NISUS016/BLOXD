use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

/// Classification of an architecture node in `.bloxd/graph.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    System,
    Service,
    Module,
    FlowStep,
    Task,
    Note,
}

impl Default for NodeKind {
    fn default() -> Self {
        Self::Module
    }
}

/// Execution status of a node tracked by users and coding agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Planned,
    InProgress,
    Blocked,
    Done,
}

impl Default for Status {
    fn default() -> Self {
        Self::Planned
    }
}

/// Semantic relationship between two nodes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    DataFlow,
    Dependency,
    Sequence,
    Triggers,
}

impl Default for EdgeKind {
    fn default() -> Self {
        Self::Dependency
    }
}

/// A single component, layer, or task in the architecture graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Node {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub kind: NodeKind,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub linked_files: Vec<String>,
    #[serde(default)]
    pub spec_file: Option<String>,
}

/// A directed edge connecting two nodes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub kind: EdgeKind,
}

/// Root semantic graph stored in `.bloxd/graph.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Graph {
    pub version: u32,
    pub project: String,
    pub updated_at: String,
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
}

impl Graph {
    /// Creates an empty v1 graph for the given project name.
    pub fn new(project: impl Into<String>) -> Self {
        Self {
            version: 1,
            project: project.into(),
            updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            nodes: Vec::new(),
            edges: Vec::new(),
        }
    }
}

/// Visual position, size, and optional accent color for a node in `.bloxd/layout.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct NodeLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Saved pan/zoom viewport for a specific layer (`"root"` or a parent node ID).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// Visual-only layout state stored in `.bloxd/layout.json` (ignored by coding agents).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Layout {
    pub version: u32,
    #[serde(default)]
    pub nodes: BTreeMap<String, NodeLayout>,
    #[serde(default)]
    pub viewports: BTreeMap<String, Viewport>,
}

impl Default for Layout {
    fn default() -> Self {
        let mut viewports = BTreeMap::new();
        viewports.insert(
            "root".to_string(),
            Viewport {
                x: 0.0,
                y: 0.0,
                zoom: 1.0,
            },
        );
        Self {
            version: 1,
            nodes: BTreeMap::new(),
            viewports,
        }
    }
}

/// Combined project state returned when opening or initializing a `.bloxd/` directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProjectSnapshot {
    pub project_path: String,
    pub graph: Graph,
    pub layout: Layout,
}
