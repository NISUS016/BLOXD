use bloxd_core::context::compile_node_context;
use bloxd_core::{
    auto_place_missing_nodes, init_or_open_project, load_graph, load_graph_with_retry,
    load_layout, read_node_spec as core_read_node_spec, save_graph as core_save_graph,
    save_layout as core_save_layout, write_node_spec as core_write_node_spec, Graph, Layout,
    ProjectSnapshot, ProjectWatcher,
};
use specta_typescript::Typescript;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_specta::{collect_commands, Builder};

pub struct AppState {
    pub project_dir: Mutex<Option<PathBuf>>,
    pub initial_project: Mutex<Option<String>>,
    pub watcher: Mutex<Option<ProjectWatcher>>,
    pub last_internal_write: Arc<Mutex<Option<Instant>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project_dir: Mutex::new(None),
            initial_project: Mutex::new(None),
            watcher: Mutex::new(None),
            last_internal_write: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
#[specta::specta]
fn get_initial_project(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut guard = state
        .initial_project
        .lock()
        .map_err(|_| "failed to lock initial project state".to_string())?;
    Ok(guard.take())
}

fn current_project_dir(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state
        .project_dir
        .lock()
        .map_err(|_| "failed to lock project state".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "no project is currently open".to_string())
}

fn mark_internal_write(state: &State<'_, AppState>) {
    if let Ok(mut guard) = state.last_internal_write.lock() {
        *guard = Some(Instant::now());
    }
}

#[tauri::command]
#[specta::specta]
fn open_project(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshot, String> {
    let dir = PathBuf::from(&path);
    let snapshot = init_or_open_project(&dir).map_err(|e| e.to_string())?;

    {
        let mut dir_guard = state
            .project_dir
            .lock()
            .map_err(|_| "failed to lock project state".to_string())?;
        *dir_guard = Some(dir.clone());
    }

    // Stop any previous watcher before starting a new one.
    {
        let mut watcher_guard = state
            .watcher
            .lock()
            .map_err(|_| "failed to lock watcher state".to_string())?;
        *watcher_guard = None;

        let watch_dir = dir.clone();
        let last_write = Arc::clone(&state.last_internal_write);
        let app_handle = app.clone();

        let watcher = ProjectWatcher::start(&dir, move || {
            if let Ok(guard) = last_write.lock() {
                if let Some(t) = *guard {
                    if t.elapsed() < Duration::from_millis(600) {
                        return;
                    }
                }
            }

            if let Ok(graph) = load_graph_with_retry(&watch_dir) {
                let mut layout = load_layout(&watch_dir).unwrap_or_default();
                if auto_place_missing_nodes(&graph, &mut layout) {
                    let _ = core_save_layout(&watch_dir, &layout);
                }
                let payload = ProjectSnapshot {
                    project_path: watch_dir.to_string_lossy().into_owned(),
                    graph,
                    layout,
                };
                let _ = app_handle.emit("bloxd://graph-updated", payload);
            }
        })
        .map_err(|e| e.to_string())?;

        *watcher_guard = Some(watcher);
    }

    Ok(snapshot)
}

#[tauri::command]
#[specta::specta]
fn save_graph(graph: Graph, state: State<'_, AppState>) -> Result<(), String> {
    let dir = current_project_dir(&state)?;
    mark_internal_write(&state);
    core_save_graph(&dir, &graph).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn save_layout(layout: Layout, state: State<'_, AppState>) -> Result<(), String> {
    let dir = current_project_dir(&state)?;
    core_save_layout(&dir, &layout).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn read_node_spec(node_id: String, state: State<'_, AppState>) -> Result<String, String> {
    let dir = current_project_dir(&state)?;
    core_read_node_spec(&dir, &node_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn write_node_spec(
    node_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dir = current_project_dir(&state)?;
    mark_internal_write(&state);
    core_write_node_spec(&dir, &node_id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn export_node_context(node_id: String, state: State<'_, AppState>) -> Result<String, String> {
    let dir = current_project_dir(&state)?;
    let graph = load_graph(&dir).map_err(|e| e.to_string())?;
    compile_node_context(&dir, &graph, &node_id).map_err(|e| e.to_string())
}

fn parse_open_arg() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--open" {
            return args.next();
        }
        if let Some(rest) = arg.strip_prefix("--open=") {
            return Some(rest.to_string());
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        get_initial_project,
        open_project,
        save_graph,
        save_layout,
        read_node_spec,
        write_node_spec,
        export_node_context,
    ]);

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/bindings.generated.ts")
        .expect("Failed to export typescript bindings");

    let app_state = AppState::default();
    if let Some(open_path) = parse_open_arg() {
        if let Ok(mut guard) = app_state.initial_project.lock() {
            *guard = Some(open_path);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
