use crate::prompts::MAP_REPO_PROMPT;
use bloxd_core::drift::{check_git_drift, mark_nodes_synced};
use bloxd_core::{
    init_or_open_project, load_graph, read_node_spec, save_graph, write_node_spec, Edge, EdgeKind,
    Graph, Node, NodeKind, Status,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::Path;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn parse_enum<T: serde::de::DeserializeOwned>(val: &Value) -> Result<T, String> {
    serde_json::from_value(val.clone()).map_err(|e| format!("invalid enum value: {e}"))
}

fn ok_response(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn err_response(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into()
        }
    })
}

fn tools_schema() -> Value {
    json!([
        {
            "name": "get_graph",
            "description": "Returns compact JSON summary of matching nodes and edges in .bloxd/graph.yaml.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "parent_id": { "type": ["string", "null"], "description": "Filter nodes by parent_id (omit for all)." },
                    "status": { "type": "string", "enum": ["planned", "in_progress", "blocked", "done"] }
                }
            }
        },
        {
            "name": "get_node",
            "description": "Returns full node fields, specs/<node-id>.md content, and 1-hop neighbor summaries.",
            "inputSchema": {
                "type": "object",
                "required": ["node_id"],
                "properties": {
                    "node_id": { "type": "string" }
                }
            }
        },
        {
            "name": "upsert_node",
            "description": "Atomically creates or updates a node in graph.yaml and optionally writes specs/<id>.md. Never modifies layout.json.",
            "inputSchema": {
                "type": "object",
                "required": ["id", "title", "kind"],
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "kind": { "type": "string", "enum": ["system", "service", "module", "flow_step", "task", "note"] },
                    "parent_id": { "type": ["string", "null"] },
                    "status": { "type": "string", "enum": ["planned", "in_progress", "blocked", "done"] },
                    "summary": { "type": "string" },
                    "linked_files": { "type": "array", "items": { "type": "string" } },
                    "constraints": { "type": "array", "items": { "type": "string" } },
                    "spec_markdown": { "type": "string" }
                }
            }
        },
        {
            "name": "delete_node",
            "description": "Removes a node (and its descendants/connected edges) from graph.yaml.",
            "inputSchema": {
                "type": "object",
                "required": ["node_id"],
                "properties": {
                    "node_id": { "type": "string" }
                }
            }
        },
        {
            "name": "upsert_edge",
            "description": "Creates or updates a directed edge between two existing nodes.",
            "inputSchema": {
                "type": "object",
                "required": ["source", "target"],
                "properties": {
                    "source": { "type": "string" },
                    "target": { "type": "string" },
                    "label": { "type": ["string", "null"] },
                    "kind": { "type": "string", "enum": ["data_flow", "dependency", "sequence", "triggers"] }
                }
            }
        },
        {
            "name": "update_status",
            "description": "Fast single-call milestone update for a node's status and optional linked_files.",
            "inputSchema": {
                "type": "object",
                "required": ["node_id", "status"],
                "properties": {
                    "node_id": { "type": "string" },
                    "status": { "type": "string", "enum": ["planned", "in_progress", "blocked", "done"] },
                    "linked_files": { "type": "array", "items": { "type": "string" } }
                }
            }
        },
        {
            "name": "get_drifted_nodes",
            "description": "Returns only nodes whose linked_files changed in Git since their last sync.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "mark_synced",
            "description": "Marks the given node_ids (or all nodes if omitted) as synced to current Git HEAD.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "node_ids": { "type": "array", "items": { "type": "string" } }
                }
            }
        }
    ])
}

fn call_tool(project_dir: &Path, name: &str, args: &Value) -> Result<Value, String> {
    init_or_open_project(project_dir).map_err(|e| e.to_string())?;

    match name {
        "get_graph" => {
            let graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let filter_parent = args.get("parent_id");
            let filter_status = args
                .get("status")
                .map(parse_enum::<Status>)
                .transpose()?;

            let nodes: Vec<Value> = graph
                .nodes
                .iter()
                .filter(|n| {
                    if let Some(p) = filter_parent {
                        if p.is_null() {
                            if n.parent_id.is_some() {
                                return false;
                            }
                        } else if n.parent_id.as_deref() != p.as_str() {
                            return false;
                        }
                    }
                    if let Some(st) = &filter_status {
                        if &n.status != st {
                            return false;
                        }
                    }
                    true
                })
                .map(|n| {
                    json!({
                        "id": n.id,
                        "title": n.title,
                        "kind": n.kind,
                        "parent_id": n.parent_id,
                        "status": n.status,
                    })
                })
                .collect();

            Ok(json!({
                "project": graph.project,
                "nodes": nodes,
                "edges": graph.edges,
            }))
        }

        "get_node" => {
            let node_id = args
                .get("node_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing node_id".to_string())?;
            let graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let node = graph
                .nodes
                .iter()
                .find(|n| n.id == node_id)
                .ok_or_else(|| format!("node '{node_id}' not found"))?;
            let spec = read_node_spec(project_dir, node_id).map_err(|e| e.to_string())?;

            let neighbors: Vec<Value> = graph
                .edges
                .iter()
                .filter(|e| e.source == node_id || e.target == node_id)
                .map(|e| {
                    let other_id = if e.source == node_id { &e.target } else { &e.source };
                    let direction = if e.source == node_id { "outgoing" } else { "incoming" };
                    let other_title = graph
                        .nodes
                        .iter()
                        .find(|n| &n.id == other_id)
                        .map(|n| n.title.as_str())
                        .unwrap_or("");
                    json!({
                        "direction": direction,
                        "node_id": other_id,
                        "title": other_title,
                        "label": e.label,
                        "kind": e.kind,
                    })
                })
                .collect();

            Ok(json!({
                "node": node,
                "spec_markdown": spec,
                "neighbors": neighbors,
            }))
        }

        "upsert_node" => {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing id".to_string())?
                .to_string();
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing title".to_string())?
                .to_string();
            let kind: NodeKind = args
                .get("kind")
                .ok_or_else(|| "missing kind".to_string())
                .and_then(parse_enum)?;

            let mut graph: Graph = load_graph(project_dir).map_err(|e| e.to_string())?;

            if let Some(existing) = graph.nodes.iter_mut().find(|n| n.id == id) {
                existing.title = title;
                existing.kind = kind;
                if let Some(p) = args.get("parent_id") {
                    existing.parent_id = p.as_str().map(|s| s.to_string());
                }
                if let Some(st) = args.get("status") {
                    existing.status = parse_enum(st)?;
                }
                if let Some(sum) = args.get("summary").and_then(|v| v.as_str()) {
                    existing.summary = sum.to_string();
                }
                if let Some(files) = args.get("linked_files").and_then(|v| v.as_array()) {
                    existing.linked_files = files
                        .iter()
                        .filter_map(|f| f.as_str().map(|s| s.to_string()))
                        .collect();
                }
                if let Some(cons) = args.get("constraints").and_then(|v| v.as_array()) {
                    existing.constraints = cons
                        .iter()
                        .filter_map(|c| c.as_str().map(|s| s.to_string()))
                        .collect();
                }
            } else {
                let parent_id = args
                    .get("parent_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let status = args
                    .get("status")
                    .map(parse_enum::<Status>)
                    .transpose()?
                    .unwrap_or_default();
                let summary = args
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let linked_files = args
                    .get("linked_files")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|f| f.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let constraints = args
                    .get("constraints")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|c| c.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();

                graph.nodes.push(Node {
                    id: id.clone(),
                    title,
                    kind,
                    parent_id,
                    status,
                    summary,
                    linked_files,
                    spec_file: Some(format!("specs/{id}.md")),
                    constraints,
                    synced_commit: None,
                });
            }

            if let Some(spec) = args.get("spec_markdown").and_then(|v| v.as_str()) {
                write_node_spec(project_dir, &id, spec).map_err(|e| e.to_string())?;
            }

            graph.updated_at = now_rfc3339();
            save_graph(project_dir, &graph).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": id }))
        }

        "delete_node" => {
            let node_id = args
                .get("node_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing node_id".to_string())?;
            let mut graph = load_graph(project_dir).map_err(|e| e.to_string())?;

            let mut to_delete = HashSet::from([node_id.to_string()]);
            let mut added = true;
            while added {
                added = false;
                for n in &graph.nodes {
                    if let Some(pid) = &n.parent_id {
                        if to_delete.contains(pid) && to_delete.insert(n.id.clone()) {
                            added = true;
                        }
                    }
                }
            }

            let before = graph.nodes.len();
            graph.nodes.retain(|n| !to_delete.contains(&n.id));
            if graph.nodes.len() == before {
                return Err(format!("node '{node_id}' not found"));
            }
            graph
                .edges
                .retain(|e| !to_delete.contains(&e.source) && !to_delete.contains(&e.target));
            graph.updated_at = now_rfc3339();
            save_graph(project_dir, &graph).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "deleted": to_delete.into_iter().collect::<Vec<_>>() }))
        }

        "upsert_edge" => {
            let source = args
                .get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing source".to_string())?
                .to_string();
            let target = args
                .get("target")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing target".to_string())?
                .to_string();
            let label = args
                .get("label")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let kind = args
                .get("kind")
                .map(parse_enum::<EdgeKind>)
                .transpose()?
                .unwrap_or_default();

            let mut graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let ids: HashSet<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
            if !ids.contains(source.as_str()) || !ids.contains(target.as_str()) {
                return Err(format!(
                    "both source ('{source}') and target ('{target}') must exist"
                ));
            }

            let edge_id = if let Some(existing) = graph
                .edges
                .iter_mut()
                .find(|e| e.source == source && e.target == target)
            {
                existing.label = label;
                existing.kind = kind;
                existing.id.clone()
            } else {
                let id = format!("e-{source}-{target}");
                graph.edges.push(Edge {
                    id: id.clone(),
                    source,
                    target,
                    label,
                    kind,
                });
                id
            };

            graph.updated_at = now_rfc3339();
            save_graph(project_dir, &graph).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": edge_id }))
        }

        "update_status" => {
            let node_id = args
                .get("node_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing node_id".to_string())?;
            let status: Status = args
                .get("status")
                .ok_or_else(|| "missing status".to_string())
                .and_then(parse_enum)?;

            let mut graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let node = graph
                .nodes
                .iter_mut()
                .find(|n| n.id == node_id)
                .ok_or_else(|| format!("node '{node_id}' not found"))?;
            node.status = status;
            if let Some(files) = args.get("linked_files").and_then(|v| v.as_array()) {
                node.linked_files = files
                    .iter()
                    .filter_map(|f| f.as_str().map(|s| s.to_string()))
                    .collect();
            }

            graph.updated_at = now_rfc3339();
            save_graph(project_dir, &graph).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "node_id": node_id }))
        }

        "get_drifted_nodes" => {
            let graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let report = check_git_drift(project_dir, &graph);
            Ok(serde_json::to_value(report).map_err(|e| e.to_string())?)
        }

        "mark_synced" => {
            let mut graph = load_graph(project_dir).map_err(|e| e.to_string())?;
            let node_ids: Vec<String> = args
                .get("node_ids")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(|x| x.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let head = mark_nodes_synced(project_dir, &mut graph, &node_ids)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "head_commit": head }))
        }

        other => Err(format!("unknown tool: {other}")),
    }
}

/// Processes a single JSON-RPC 2.0 request and returns an optional response (notifications return None).
pub fn handle_request(project_dir: &Path, req: &Value) -> Option<Value> {
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = req.get("id").cloned();

    if method == "notifications/initialized" || id.is_none() {
        return None;
    }

    let id = id.unwrap();
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    let resp = match method {
        "initialize" => ok_response(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "prompts": {}
                },
                "serverInfo": {
                    "name": "bloxd",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        ),

        "tools/list" => ok_response(id, json!({ "tools": tools_schema() })),

        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call_tool(project_dir, name, &args) {
                Ok(payload) => ok_response(
                    id,
                    json!({
                        "content": [
                            {
                                "type": "text",
                                "text": serde_json::to_string_pretty(&payload).unwrap_or_default()
                            }
                        ]
                    }),
                ),
                Err(msg) => ok_response(
                    id,
                    json!({
                        "isError": true,
                        "content": [{ "type": "text", "text": msg }]
                    }),
                ),
            }
        }

        "prompts/list" => ok_response(
            id,
            json!({
                "prompts": [
                    {
                        "name": "map_repo",
                        "description": "Guide the AI agent to scan the repository and populate .bloxd/ nested architecture."
                    }
                ]
            }),
        ),

        "prompts/get" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == "map_repo" {
                ok_response(
                    id,
                    json!({
                        "description": "Map the repository into .bloxd/",
                        "messages": [
                            {
                                "role": "user",
                                "content": {
                                    "type": "text",
                                    "text": MAP_REPO_PROMPT
                                }
                            }
                        ]
                    }),
                )
            } else {
                err_response(id, -32602, format!("unknown prompt: {name}"))
            }
        }

        other => err_response(id, -32601, format!("method not found: {other}")),
    };

    Some(resp)
}

/// Runs the newline-delimited JSON-RPC 2.0 MCP server over `reader` and `writer`.
pub fn run_stdio_loop<R: BufRead, W: Write>(
    reader: R,
    mut writer: W,
    project_dir: &Path,
) -> std::io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("bloxd mcp: invalid JSON: {e}");
                let err = err_response(Value::Null, -32700, format!("parse error: {e}"));
                writeln!(writer, "{}", serde_json::to_string(&err).unwrap())?;
                writer.flush()?;
                continue;
            }
        };

        if let Some(resp) = handle_request(project_dir, &req) {
            writeln!(writer, "{}", serde_json::to_string(&resp).unwrap())?;
            writer.flush()?;
        }
    }
    Ok(())
}
