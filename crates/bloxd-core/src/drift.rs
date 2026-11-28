use crate::model::{DriftReport, Graph};
use crate::storage::{read_node_spec, save_graph, BloxdError};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::process::Command;

fn run_git(project_dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(project_dir)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn normalize_path(p: &str) -> String {
    p.trim().trim_matches('"').replace('\\', "/")
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p_chars: Vec<char> = pattern.chars().collect();
    let t_chars: Vec<char> = text.chars().collect();
    let mut dp = vec![vec![false; t_chars.len() + 1]; p_chars.len() + 1];
    dp[0][0] = true;

    for i in 1..=p_chars.len() {
        if p_chars[i - 1] == '*' {
            dp[i][0] = dp[i - 1][0];
        }
    }

    for i in 1..=p_chars.len() {
        for j in 1..=t_chars.len() {
            if p_chars[i - 1] == '*' {
                dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
            } else if p_chars[i - 1] == '?' || p_chars[i - 1] == t_chars[j - 1] {
                dp[i][j] = dp[i - 1][j - 1];
            }
        }
    }

    dp[p_chars.len()][t_chars.len()]
}

fn path_matches_pattern(changed_file: &str, linked_pattern: &str) -> bool {
    let file = normalize_path(changed_file);
    let pat = normalize_path(linked_pattern);
    if pat.is_empty() {
        return false;
    }
    if pat.contains('*') || pat.contains('?') {
        return glob_match(&pat, &file);
    }
    if pat.ends_with('/') {
        return file.starts_with(&pat);
    }
    file == pat || file.starts_with(&format!("{pat}/"))
}

/// Computes zero-token Git drift for all nodes in `graph` against their `linked_files`.
pub fn check_git_drift(project_dir: &Path, graph: &Graph) -> DriftReport {
    let Some(head_raw) = run_git(project_dir, &["rev-parse", "HEAD"]) else {
        return DriftReport::default();
    };
    let head_commit = head_raw.trim().to_string();

    // Working tree changes (staged, unstaged, untracked)
    let mut working_changes: Vec<String> = Vec::new();
    if let Some(porcelain) = run_git(project_dir, &["status", "--porcelain"]) {
        for line in porcelain.lines() {
            if line.len() > 3 {
                let raw_path = &line[3..];
                // Handle rename syntax `old -> new`
                let actual = raw_path.split(" -> ").last().unwrap_or(raw_path);
                let norm = normalize_path(actual);
                if !norm.starts_with(".bloxd/") {
                    working_changes.push(norm);
                }
            }
        }
    }

    let mut diff_cache: HashMap<String, Vec<String>> = HashMap::new();
    let mut drifted: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for node in &graph.nodes {
        if node.linked_files.is_empty() {
            continue;
        }

        let base_commit = node
            .synced_commit
            .as_deref()
            .or(graph.last_synced_commit.as_deref());

        let mut candidate_files: HashSet<String> = working_changes.iter().cloned().collect();

        if let Some(base) = base_commit {
            if base != head_commit {
                let diff_files = diff_cache.entry(base.to_string()).or_insert_with(|| {
                    let range = format!("{base}..HEAD");
                    run_git(project_dir, &["diff", "--name-only", &range])
                        .map(|out| {
                            out.lines()
                                .map(normalize_path)
                                .filter(|p| !p.is_empty() && !p.starts_with(".bloxd/"))
                                .collect()
                        })
                        .unwrap_or_default()
                });
                for f in diff_files {
                    candidate_files.insert(f.clone());
                }
            }
        }

        let mut matched: Vec<String> = candidate_files
            .into_iter()
            .filter(|f| node.linked_files.iter().any(|pat| path_matches_pattern(f, pat)))
            .collect();
        matched.sort();

        if !matched.is_empty() {
            drifted.insert(node.id.clone(), matched);
        }
    }

    DriftReport {
        head_commit: Some(head_commit),
        is_git_repo: true,
        drifted,
    }
}

/// Marks the specified `node_ids` (or all nodes + `last_synced_commit` if empty) as synced to `HEAD`.
pub fn mark_nodes_synced(
    project_dir: &Path,
    graph: &mut Graph,
    node_ids: &[String],
) -> Result<Option<String>, BloxdError> {
    let head = run_git(project_dir, &["rev-parse", "HEAD"]).map(|s| s.trim().to_string());
    let Some(commit) = head.clone() else {
        return Ok(None);
    };

    if node_ids.is_empty() {
        graph.last_synced_commit = Some(commit.clone());
        for n in &mut graph.nodes {
            n.synced_commit = Some(commit.clone());
        }
    } else {
        let target_set: HashSet<&str> = node_ids.iter().map(|s| s.as_str()).collect();
        for n in &mut graph.nodes {
            if target_set.contains(n.id.as_str()) {
                n.synced_commit = Some(commit.clone());
            }
        }
        if graph.last_synced_commit.is_none() {
            graph.last_synced_commit = Some(commit.clone());
        }
    }

    graph.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    save_graph(project_dir, graph)?;
    Ok(head)
}

/// Compiles a targeted sync prompt for drifted nodes so a cheap subagent only updates stale docs.
pub fn export_drift_sync_prompt(
    project_dir: &Path,
    graph: &Graph,
    node_ids: &[String],
) -> Result<String, BloxdError> {
    let report = check_git_drift(project_dir, graph);
    let filter: HashSet<&str> = node_ids.iter().map(|s| s.as_str()).collect();

    let mut out = String::new();
    out.push_str("# bloxd Partial Sync Request\n\n");
    out.push_str("The following architecture nodes have drifted relative to their `linked_files`. Review only the changed files below and update each node's summary, `linked_files`, `status`, and `specs/<node-id>.md` via `bloxd mcp` (or direct edits), then call `mark_synced`.\n\n");

    let mut count = 0;
    for node in &graph.nodes {
        if !filter.is_empty() && !filter.contains(node.id.as_str()) {
            continue;
        }
        let Some(files) = report.drifted.get(&node.id) else {
            continue;
        };
        count += 1;
        out.push_str(&format!("## {} (`{}`)\n", node.title, node.id));
        out.push_str("- **Changed files:**\n");
        for f in files {
            out.push_str(&format!("  - `{f}`\n"));
        }
        let spec = read_node_spec(project_dir, &node.id)?;
        if !spec.trim().is_empty() {
            out.push_str(&format!(
                "- **Current spec (`specs/{}.md`):**\n```markdown\n{}\n```\n",
                node.id,
                spec.trim()
            ));
        }
        out.push('\n');
    }

    if count == 0 {
        out.push_str("_No drifted nodes found for the selected filter._\n");
    }

    Ok(out)
}
