pub mod agents_md;
pub mod context;
pub mod drift;
pub mod model;
pub mod storage;
pub mod watcher;

pub use model::{
    ChecklistProgress, DriftReport, Edge, EdgeKind, EdgeRoute, Graph, LabelOffset, Layout, Node,
    NodeKind, NodeLayout, Point2D, ProjectSnapshot, Status, Viewport,
};
pub use storage::{
    auto_place_missing_nodes, compute_project_checklists, init_or_open_project, load_graph,
    load_layout, parse_checklist_progress, read_node_spec, save_graph, save_layout,
    write_node_spec, BloxdError,
};
pub use watcher::{load_graph_with_retry, ProjectWatcher};
