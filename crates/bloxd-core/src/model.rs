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

fn is_false(v: &bool) -> bool {
    !*v
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synced_commit: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub proposed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal_note: Option<String>,
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
    #[serde(default, skip_serializing_if = "is_false")]
    pub proposed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal_note: Option<String>,
}

/// Root semantic graph stored in `.bloxd/graph.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Graph {
    pub version: u32,
    pub project: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_commit: Option<String>,
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
            last_synced_commit: None,
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

/// Optional user-dragged offset for an edge label pill in `.bloxd/layout.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LabelOffset {
    pub x: f64,
    pub y: f64,
}

/// 2D point in canvas world coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Point2D {
    pub x: f64,
    pub y: f64,
}

/// Precomputed ELK orthogonal edge polyline & label anchor for `.bloxd/layout.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EdgeRoute {
    pub points: Vec<Point2D>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_pos: Option<Point2D>,
    pub source_side: String,
    pub target_side: String,
}

/// Visual-only layout state stored in `.bloxd/layout.json` (ignored by coding agents).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Layout {
    pub version: u32,
    #[serde(default)]
    pub nodes: BTreeMap<String, NodeLayout>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub unified_nodes: BTreeMap<String, NodeLayout>,
    #[serde(default)]
    pub viewports: BTreeMap<String, Viewport>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub edge_labels: BTreeMap<String, LabelOffset>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub unified_edge_labels: BTreeMap<String, LabelOffset>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub edge_routes: BTreeMap<String, EdgeRoute>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub unified_edge_routes: BTreeMap<String, EdgeRoute>,
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
            unified_nodes: BTreeMap::new(),
            viewports,
            edge_labels: BTreeMap::new(),
            unified_edge_labels: BTreeMap::new(),
            edge_routes: BTreeMap::new(),
            unified_edge_routes: BTreeMap::new(),
        }
    }
}

/// Parsed Markdown task checklist progress (`- [ ]` / `- [x]`) for a node spec.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
pub struct ChecklistProgress {
    pub done: u32,
    pub total: u32,
}

/// Zero-token Git drift report mapping drifted node IDs to changed file paths.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
pub struct DriftReport {
    pub head_commit: Option<String>,
    pub is_git_repo: bool,
    pub drifted: BTreeMap<String, Vec<String>>,
}

/// Combined project state returned when opening or initializing a `.bloxd/` directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProjectSnapshot {
    pub project_path: String,
    pub graph: Graph,
    pub layout: Layout,
    #[serde(default)]
    pub checklists: BTreeMap<String, ChecklistProgress>,
}
