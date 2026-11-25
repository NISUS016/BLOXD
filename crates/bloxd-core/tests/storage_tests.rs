use bloxd_core::context::compile_node_context;
use bloxd_core::{
    auto_place_missing_nodes, init_or_open_project, load_graph, load_layout, read_node_spec,
    save_graph, save_layout, write_node_spec, BloxdError, Edge, EdgeKind, Node, NodeKind,
    NodeLayout, Status,
};
use tempfile::TempDir;

#[test]
fn init_creates_bloxd_structure_and_reopens_cleanly() {
    let dir = TempDir::new().unwrap();
    let snapshot = init_or_open_project(dir.path()).unwrap();

    assert_eq!(snapshot.graph.version, 1);
    assert_eq!(snapshot.layout.version, 1);
    assert!(snapshot.layout.viewports.contains_key("root"));
    assert!(dir.path().join(".bloxd/graph.yaml").exists());
    assert!(dir.path().join(".bloxd/layout.json").exists());
    assert!(dir.path().join(".bloxd/AGENTS.md").exists());
    assert!(dir.path().join(".bloxd/specs").is_dir());

    let agents = std::fs::read_to_string(dir.path().join(".bloxd/AGENTS.md")).unwrap();
    assert!(agents.contains("NEVER modify `.bloxd/layout.json`"));

    // Modify graph and verify re-opening preserves it
    let mut graph = snapshot.graph;
    graph.nodes.push(Node {
        id: "backend".to_string(),
        title: "Backend API".to_string(),
        kind: NodeKind::System,
        parent_id: None,
        status: Status::InProgress,
        summary: "Core REST API".to_string(),
        linked_files: vec!["src/main.rs".to_string()],
        spec_file: Some("specs/backend.md".to_string()),
    });
    save_graph(dir.path(), &graph).unwrap();

    let reopened = init_or_open_project(dir.path()).unwrap();
    assert_eq!(reopened.graph.nodes.len(), 1);
    assert_eq!(reopened.graph.nodes[0].id, "backend");
    assert_eq!(reopened.graph.nodes[0].status, Status::InProgress);
}

#[test]
fn graph_and_layout_roundtrip() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();

    snapshot.graph.nodes.push(Node {
        id: "api".to_string(),
        title: "API".to_string(),
        kind: NodeKind::Service,
        parent_id: None,
        status: Status::Planned,
        summary: "Gateway".to_string(),
        linked_files: vec![],
        spec_file: None,
    });
    snapshot.graph.nodes.push(Node {
        id: "auth".to_string(),
        title: "Auth".to_string(),
        kind: NodeKind::Module,
        parent_id: Some("api".to_string()),
        status: Status::Done,
        summary: "JWT auth".to_string(),
        linked_files: vec!["src/auth.rs".to_string()],
        spec_file: Some("specs/auth.md".to_string()),
    });
    snapshot.graph.edges.push(Edge {
        id: "e1".to_string(),
        source: "api".to_string(),
        target: "auth".to_string(),
        label: Some("delegates".to_string()),
        kind: EdgeKind::DataFlow,
    });

    save_graph(dir.path(), &snapshot.graph).unwrap();
    let loaded_graph = load_graph(dir.path()).unwrap();
    assert_eq!(loaded_graph, snapshot.graph);

    snapshot.layout.nodes.insert(
        "api".to_string(),
        NodeLayout {
            x: 120.0,
            y: 80.0,
            width: 260.0,
            height: 120.0,
            color: Some("#3b82f6".to_string()),
        },
    );
    save_layout(dir.path(), &snapshot.layout).unwrap();
    let loaded_layout = load_layout(dir.path()).unwrap();
    assert_eq!(loaded_layout, snapshot.layout);
}

#[test]
fn specs_read_write_and_path_traversal_guard() {
    let dir = TempDir::new().unwrap();
    init_or_open_project(dir.path()).unwrap();

    // Missing spec returns empty string
    assert_eq!(read_node_spec(dir.path(), "auth").unwrap(), "");

    write_node_spec(dir.path(), "auth", "# Auth Spec\n\nVerify JWTs.").unwrap();
    assert_eq!(
        read_node_spec(dir.path(), "auth").unwrap(),
        "# Auth Spec\n\nVerify JWTs."
    );

    // Path traversal should be rejected
    assert!(matches!(
        write_node_spec(dir.path(), "../escape", "bad"),
        Err(BloxdError::InvalidNodeId(_))
    ));
    assert!(matches!(
        read_node_spec(dir.path(), "sub/dir"),
        Err(BloxdError::InvalidNodeId(_))
    ));
    assert!(matches!(
        read_node_spec(dir.path(), ""),
        Err(BloxdError::InvalidNodeId(_))
    ));
}

#[test]
fn compile_node_context_includes_parent_neighbors_children_and_spec() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();

    snapshot.graph.nodes = vec![
        Node {
            id: "backend".to_string(),
            title: "Backend API".to_string(),
            kind: NodeKind::System,
            parent_id: None,
            status: Status::InProgress,
            summary: "Core REST API".to_string(),
            linked_files: vec![],
            spec_file: None,
        },
        Node {
            id: "gateway".to_string(),
            title: "API Gateway".to_string(),
            kind: NodeKind::Service,
            parent_id: None,
            status: Status::Done,
            summary: "Routes external requests.".to_string(),
            linked_files: vec!["src/gateway.rs".to_string()],
            spec_file: None,
        },
        Node {
            id: "worker".to_string(),
            title: "Job Worker".to_string(),
            kind: NodeKind::Service,
            parent_id: Some("backend".to_string()),
            status: Status::InProgress,
            summary: "Processes background jobs.".to_string(),
            linked_files: vec!["src/worker.rs".to_string()],
            spec_file: Some("specs/worker.md".to_string()),
        },
        Node {
            id: "queue".to_string(),
            title: "Redis Queue".to_string(),
            kind: NodeKind::Module,
            parent_id: Some("worker".to_string()),
            status: Status::Planned,
            summary: "Job queue".to_string(),
            linked_files: vec![],
            spec_file: None,
        },
    ];
    snapshot.graph.edges.push(Edge {
        id: "e1".to_string(),
        source: "gateway".to_string(),
        target: "worker".to_string(),
        label: Some("dispatches".to_string()),
        kind: EdgeKind::Triggers,
    });
    write_node_spec(dir.path(), "worker", "## Requirements\n- Retry 3 times.").unwrap();

    let ctx = compile_node_context(dir.path(), &snapshot.graph, "worker").unwrap();
    assert!(ctx.contains("Job Worker (`worker`)"));
    assert!(ctx.contains("Retry 3 times."));
    assert!(ctx.contains("Parent Context: Backend API (`backend`)"));
    assert!(ctx.contains("**API Gateway** (`gateway`)"));
    assert!(ctx.contains("Redis Queue"));
    assert!(ctx.contains("Sync reminder"));

    assert!(matches!(
        compile_node_context(dir.path(), &snapshot.graph, "missing"),
        Err(BloxdError::NotFound(_))
    ));
}

#[test]
fn auto_place_missing_nodes_places_without_overlap() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();
    snapshot.graph.nodes.push(Node {
        id: "a".to_string(),
        title: "A".to_string(),
        kind: NodeKind::Module,
        parent_id: None,
        status: Status::Planned,
        summary: String::new(),
        linked_files: vec![],
        spec_file: None,
    });
    snapshot.graph.nodes.push(Node {
        id: "b".to_string(),
        title: "B".to_string(),
        kind: NodeKind::Module,
        parent_id: None,
        status: Status::Planned,
        summary: String::new(),
        linked_files: vec![],
        spec_file: None,
    });
    snapshot.layout.nodes.insert(
        "a".to_string(),
        NodeLayout {
            x: 80.0,
            y: 80.0,
            width: 240.0,
            height: 110.0,
            color: None,
        },
    );

    assert!(auto_place_missing_nodes(&snapshot.graph, &mut snapshot.layout));
    let a = &snapshot.layout.nodes["a"];
    let b = &snapshot.layout.nodes["b"];
    assert!((a.x - b.x).abs() >= 250.0 || (a.y - b.y).abs() >= 130.0);
    assert!(!auto_place_missing_nodes(&snapshot.graph, &mut snapshot.layout));
}
