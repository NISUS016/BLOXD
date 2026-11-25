use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use tempfile::TempDir;

fn send_and_read(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    req: Value,
) -> Value {
    writeln!(stdin, "{}", serde_json::to_string(&req).unwrap()).unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    serde_json::from_str(&line).expect("valid JSON-RPC response")
}

#[test]
fn mcp_stdio_end_to_end() {
    let dir = TempDir::new().unwrap();
    let bin = env!("CARGO_BIN_EXE_bloxd");

    let mut child = Command::new(bin)
        .arg("mcp")
        .arg("--project")
        .arg(dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn bloxd mcp");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    // 1. initialize
    let init_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }),
    );
    assert_eq!(init_resp["result"]["serverInfo"]["name"], "bloxd");

    // 2. notifications/initialized (no response expected)
    writeln!(
        stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    )
    .unwrap();
    stdin.flush().unwrap();

    // 3. tools/list
    let tools_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }),
    );
    let tools = tools_resp["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 6);

    // 4. upsert_node (x2)
    let up1 = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "upsert_node",
                "arguments": {
                    "id": "api",
                    "title": "API Service",
                    "kind": "service",
                    "summary": "Handles HTTP requests",
                    "spec_markdown": "# API Spec\n\nREST endpoints."
                }
            }
        }),
    );
    assert!(up1["result"]["isError"].is_null());

    let up2 = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "upsert_node",
                "arguments": {
                    "id": "db",
                    "title": "Database",
                    "kind": "module",
                    "parent_id": "api"
                }
            }
        }),
    );
    assert!(up2["result"]["isError"].is_null());

    // 5. upsert_edge
    let edge_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "upsert_edge",
                "arguments": {
                    "source": "api",
                    "target": "db",
                    "label": "queries",
                    "kind": "data_flow"
                }
            }
        }),
    );
    assert!(edge_resp["result"]["isError"].is_null());

    // 6. update_status
    let st_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "update_status",
                "arguments": {
                    "node_id": "api",
                    "status": "done",
                    "linked_files": ["src/api.rs"]
                }
            }
        }),
    );
    assert!(st_resp["result"]["isError"].is_null());

    // 7. get_graph
    let graph_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {
                "name": "get_graph",
                "arguments": {}
            }
        }),
    );
    let text = graph_resp["result"]["content"][0]["text"].as_str().unwrap();
    let parsed: Value = serde_json::from_str(text).unwrap();
    assert_eq!(parsed["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(parsed["edges"].as_array().unwrap().len(), 1);

    // 8. prompts/get
    let prompt_resp = send_and_read(
        &mut stdin,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "prompts/get",
            "params": { "name": "map_repo" }
        }),
    );
    let prompt_text = prompt_resp["result"]["messages"][0]["content"]["text"]
        .as_str()
        .unwrap();
    assert!(prompt_text.contains("upsert_node"));

    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success());

    // Verify layout.json was untouched (no node coordinates written by MCP)
    let layout = bloxd_core::load_layout(dir.path()).unwrap();
    assert!(layout.nodes.is_empty());
}
