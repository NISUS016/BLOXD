use bloxd_core::context::{compile_multi_node_context, compile_node_context};
use bloxd_core::drift::{check_git_drift, mark_nodes_synced};
use bloxd_core::{
    accept_all_proposals, accept_edge_proposal, accept_node_proposal, auto_place_missing_nodes,
    init_or_open_project, load_graph, load_layout, parse_checklist_progress, read_node_spec,
    reject_all_proposals, reject_edge_proposal, reject_node_proposal, save_graph, save_layout,
    write_node_spec, BloxdError, Edge, EdgeKind, EdgeRoute, Node, NodeKind, NodeLayout, Point2D,
    Status,
};
use std::process::Command;
use tempfile::TempDir;

fn make_node(id: &str, title: &str, kind: NodeKind, parent_id: Option<&str>) -> Node {
    Node {
        id: id.to_string(),
        title: title.to_string(),
        kind,
        parent_id: parent_id.map(|s| s.to_string()),
        status: Status::Planned,
        summary: String::new(),
        linked_files: vec![],
        spec_file: Some(format!("specs/{id}.md")),
        constraints: vec![],
        synced_commit: None,
        proposed: false,
        proposal_note: None,
    }
}

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

    let mut graph = snapshot.graph;
    let mut node = make_node("backend", "Backend API", NodeKind::System, None);
    node.status = Status::InProgress;
    node.summary = "Core REST API".to_string();
    node.linked_files = vec!["src/main.rs".to_string()];
    graph.nodes.push(node);
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

    let mut api = make_node("api", "API", NodeKind::Service, None);
    api.summary = "Gateway".to_string();
    api.spec_file = None;

    let mut auth = make_node("auth", "Auth", NodeKind::Module, Some("api"));
    auth.status = Status::Done;
    auth.summary = "JWT auth".to_string();
    auth.linked_files = vec!["src/auth.rs".to_string()];
    auth.constraints = vec!["Always verify JWT exp claim".to_string()];

    snapshot.graph.nodes.push(api);
    snapshot.graph.nodes.push(auth);
    snapshot.graph.edges.push(Edge {
        id: "e1".to_string(),
        source: "api".to_string(),
        target: "auth".to_string(),
        label: Some("delegates".to_string()),
        kind: EdgeKind::DataFlow,
        proposed: false,
        proposal_note: None,
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

    assert_eq!(read_node_spec(dir.path(), "auth").unwrap(), "");

    write_node_spec(dir.path(), "auth", "# Auth Spec\n\nVerify JWTs.").unwrap();
    assert_eq!(
        read_node_spec(dir.path(), "auth").unwrap(),
        "# Auth Spec\n\nVerify JWTs."
    );

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
fn compile_node_context_includes_parent_neighbors_children_constraints_and_spec() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();

    let mut backend = make_node("backend", "Backend API", NodeKind::System, None);
    backend.status = Status::InProgress;
    backend.summary = "Core REST API".to_string();

    let mut gateway = make_node("gateway", "API Gateway", NodeKind::Service, None);
    gateway.status = Status::Done;
    gateway.summary = "Routes external requests.".to_string();
    gateway.linked_files = vec!["src/gateway.rs".to_string()];

    let mut worker = make_node("worker", "Job Worker", NodeKind::Service, Some("backend"));
    worker.status = Status::InProgress;
    worker.summary = "Processes background jobs.".to_string();
    worker.linked_files = vec!["src/worker.rs".to_string()];
    worker.constraints = vec!["Idempotent retries only".to_string()];

    let queue = make_node("queue", "Redis Queue", NodeKind::Module, Some("worker"));

    snapshot.graph.nodes = vec![backend, gateway, worker, queue];
    snapshot.graph.edges.push(Edge {
        id: "e1".to_string(),
        source: "gateway".to_string(),
        target: "worker".to_string(),
        label: Some("dispatches".to_string()),
        kind: EdgeKind::Triggers,
        proposed: false,
        proposal_note: None,
    });
    write_node_spec(dir.path(), "worker", "## Requirements\n- Retry 3 times.").unwrap();

    let ctx = compile_node_context(dir.path(), &snapshot.graph, "worker").unwrap();
    assert!(ctx.contains("Job Worker (`worker`)"));
    assert!(ctx.contains("Idempotent retries only"));
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
    snapshot.graph.nodes.push(make_node("a", "A", NodeKind::Module, None));
    snapshot.graph.nodes.push(make_node("b", "B", NodeKind::Module, None));
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

#[test]
fn checklist_parser_counts_tasks() {
    let md = "# Spec\n- [x] Setup\n- [ ] Tests\n  * [X] Docs\n- Not a task\n";
    let p = parse_checklist_progress(md);
    assert_eq!(p.done, 2);
    assert_eq!(p.total, 3);
}

#[test]
fn multi_node_context_deduplicates_boundary_neighbors() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();

    let ui = make_node("ui", "UI", NodeKind::Module, None);
    let ipc = make_node("ipc", "IPC", NodeKind::Service, None);
    let mut store = make_node("store", "Store", NodeKind::Module, None);
    store.summary = "Shared state".to_string();

    snapshot.graph.nodes = vec![ui, ipc, store];
    snapshot.graph.edges = vec![
        Edge {
            id: "e1".into(),
            source: "ui".into(),
            target: "ipc".into(),
            label: Some("calls".into()),
            kind: EdgeKind::DataFlow,
            proposed: false,
            proposal_note: None,
        },
        Edge {
            id: "e2".into(),
            source: "ui".into(),
            target: "store".into(),
            label: None,
            kind: EdgeKind::Dependency,
            proposed: false,
            proposal_note: None,
        },
        Edge {
            id: "e3".into(),
            source: "ipc".into(),
            target: "store".into(),
            label: None,
            kind: EdgeKind::Dependency,
            proposed: false,
            proposal_note: None,
        },
    ];

    let ctx = compile_multi_node_context(dir.path(), &snapshot.graph, &["ui".into(), "ipc".into()])
        .unwrap();
    assert!(ctx.contains("Feature Slice Context (2 nodes)"));
    assert!(ctx.contains("`ui` → `ipc`"));
    assert_eq!(ctx.matches("**Store** (`store`)").count(), 1);
}

#[test]
fn git_drift_handles_non_git_and_git_repos() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();
    let mut api = make_node("api", "API", NodeKind::Service, None);
    api.linked_files = vec!["src/api.rs".to_string()];
    snapshot.graph.nodes.push(api);

    // Non-git directory gracefully returns empty report
    let non_git = check_git_drift(dir.path(), &snapshot.graph);
    assert!(!non_git.is_git_repo);
    assert!(non_git.drifted.is_empty());

    // Initialize git repo
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    std::fs::write(dir.path().join("src/api.rs"), "fn a() {}\n").unwrap();
    Command::new("git").arg("-C").arg(dir.path()).arg("init").output().unwrap();
    Command::new("git").arg("-C").arg(dir.path()).args(["config", "user.email", "test@bloxd.dev"]).output().unwrap();
    Command::new("git").arg("-C").arg(dir.path()).args(["config", "user.name", "Test"]).output().unwrap();
    Command::new("git").arg("-C").arg(dir.path()).args(["add", "."]).output().unwrap();
    Command::new("git").arg("-C").arg(dir.path()).args(["commit", "-m", "init"]).output().unwrap();

    mark_nodes_synced(dir.path(), &mut snapshot.graph, &[]).unwrap();
    assert!(check_git_drift(dir.path(), &snapshot.graph).drifted.is_empty());

    // Modify linked file in working tree -> drift detected
    std::fs::write(dir.path().join("src/api.rs"), "fn a() { println!(\"hi\"); }\n").unwrap();
    let drifted = check_git_drift(dir.path(), &snapshot.graph);
    assert!(drifted.is_git_repo);
    assert_eq!(drifted.drifted.get("api").unwrap(), &vec!["src/api.rs".to_string()]);
}

#[test]
fn proposals_accept_reject_and_incremental_unified_placement() {
    let dir = TempDir::new().unwrap();
    let mut snapshot = init_or_open_project(dir.path()).unwrap();

    let api = make_node("api", "API", NodeKind::Service, None);
    let mut cache = make_node("cache", "Redis Cache", NodeKind::Service, None);
    cache.proposed = true;
    cache.proposal_note = Some("Add response caching".into());
    let mut worker = make_node("worker", "Worker", NodeKind::Service, None);
    worker.proposed = true;

    snapshot.graph.nodes = vec![api, cache, worker];
    snapshot.graph.edges = vec![
        Edge {
            id: "e-api-cache".into(),
            source: "api".into(),
            target: "cache".into(),
            label: Some("reads".into()),
            kind: EdgeKind::DataFlow,
            proposed: true,
            proposal_note: Some("Cache hit path".into()),
        },
        Edge {
            id: "e-api-worker".into(),
            source: "api".into(),
            target: "worker".into(),
            label: None,
            kind: EdgeKind::Triggers,
            proposed: false,
            proposal_note: None,
        },
    ];

    // Seed unified_nodes for existing "api" node to verify incremental placement for incoming proposals
    snapshot.layout.unified_nodes.insert(
        "api".into(),
        NodeLayout {
            x: 100.0,
            y: 100.0,
            width: 260.0,
            height: 136.0,
            color: None,
        },
    );
    snapshot.layout.unified_edge_routes.insert(
        "e-api-worker".into(),
        EdgeRoute {
            points: vec![Point2D { x: 0.0, y: 0.0 }, Point2D { x: 100.0, y: 0.0 }],
            label_pos: None,
            source_side: "right".into(),
            target_side: "left".into(),
        },
    );

    assert!(auto_place_missing_nodes(&snapshot.graph, &mut snapshot.layout));
    assert!(snapshot.layout.nodes.contains_key("cache"));
    assert!(snapshot.layout.unified_nodes.contains_key("cache"));
    assert_eq!(snapshot.layout.unified_nodes["api"].x, 100.0);

    // Rejecting proposed node "worker" deletes dangling edge "e-api-worker" and prunes its route
    assert!(reject_node_proposal(&mut snapshot.graph, Some(&mut snapshot.layout), "worker"));
    assert!(snapshot.graph.nodes.iter().all(|n| n.id != "worker"));
    assert!(snapshot.graph.edges.iter().all(|e| e.id != "e-api-worker"));
    assert!(!snapshot.layout.unified_edge_routes.contains_key("e-api-worker"));

    // Accept single node + edge, and test single edge rejection
    assert!(accept_node_proposal(&mut snapshot.graph, "cache"));
    assert!(accept_edge_proposal(&mut snapshot.graph, "e-api-cache"));
    assert!(!snapshot.graph.nodes.iter().find(|n| n.id == "cache").unwrap().proposed);
    assert!(!snapshot.graph.edges[0].proposed);

    snapshot.graph.edges.push(Edge {
        id: "e-cache-api".into(),
        source: "cache".into(),
        target: "api".into(),
        label: None,
        kind: EdgeKind::DataFlow,
        proposed: true,
        proposal_note: None,
    });
    assert!(reject_edge_proposal(&mut snapshot.graph, Some(&mut snapshot.layout), "e-cache-api"));
    assert!(snapshot.graph.edges.iter().all(|e| e.id != "e-cache-api"));

    // Bulk accept & reject
    let mut temp_node = make_node("temp", "Temp", NodeKind::Module, None);
    temp_node.proposed = true;
    snapshot.graph.nodes.push(temp_node);
    assert_eq!(accept_all_proposals(&mut snapshot.graph), 1);
    assert!(!snapshot.graph.nodes.iter().find(|n| n.id == "temp").unwrap().proposed);

    let mut temp2 = make_node("temp2", "Temp2", NodeKind::Module, None);
    temp2.proposed = true;
    snapshot.graph.nodes.push(temp2);
    snapshot.graph.edges.push(Edge {
        id: "e-t2".into(),
        source: "api".into(),
        target: "temp2".into(),
        label: None,
        kind: EdgeKind::Dependency,
        proposed: true,
        proposal_note: None,
    });
    assert_eq!(reject_all_proposals(&mut snapshot.graph, Some(&mut snapshot.layout)), 2);
    assert!(snapshot.graph.nodes.iter().all(|n| n.id != "temp2"));
    assert!(snapshot.graph.edges.iter().all(|e| e.id != "e-t2"));
}
