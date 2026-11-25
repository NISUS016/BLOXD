use crate::model::Graph;
use crate::storage::{load_graph, BloxdError};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const DEBOUNCE_MS: u64 = 250;
const LOAD_RETRIES: usize = 3;
const LOAD_RETRY_BACKOFF_MS: u64 = 50;

/// Attempts to load `.bloxd/graph.yaml` with up to 3 retries (50 ms backoff) to ride out brief Windows file locks.
pub fn load_graph_with_retry(project_dir: &Path) -> Result<Graph, BloxdError> {
    let mut last_err = None;
    for attempt in 0..=LOAD_RETRIES {
        match load_graph(project_dir) {
            Ok(graph) => return Ok(graph),
            Err(err) => {
                last_err = Some(err);
                if attempt < LOAD_RETRIES {
                    thread::sleep(Duration::from_millis(LOAD_RETRY_BACKOFF_MS));
                }
            }
        }
    }
    Err(last_err.expect("retry loop executes at least once"))
}

/// Watches `.bloxd/graph.yaml` and `.bloxd/specs/` and invokes `on_change` after a 250 ms debounce.
pub struct ProjectWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl ProjectWatcher {
    /// Starts watching `.bloxd/` inside `project_dir`.
    pub fn start<F>(project_dir: &Path, on_change: F) -> Result<Self, BloxdError>
    where
        F: Fn() + Send + 'static,
    {
        let bloxd_root = project_dir.join(".bloxd");
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        )
        .map_err(|e| BloxdError::Io(std::io::Error::other(e.to_string())))?;

        watcher
            .watch(&bloxd_root, RecursiveMode::Recursive)
            .map_err(|e| BloxdError::Io(std::io::Error::other(e.to_string())))?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = Arc::clone(&stop);

        let handle = thread::spawn(move || {
            let _watcher = watcher;
            let mut dirty = false;

            loop {
                if stop_thread.load(Ordering::Relaxed) {
                    break;
                }

                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok(Ok(event)) => {
                        let is_semantic = event.paths.iter().any(|p| {
                            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                            if name == "layout.json" || name.ends_with(".tmp") {
                                return false;
                            }
                            name == "graph.yaml"
                                || p.components().any(|c| c.as_os_str() == "specs")
                        });
                        if is_semantic {
                            dirty = true;
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(RecvTimeoutError::Timeout) => {
                        if dirty {
                            dirty = false;
                            on_change();
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }
}

impl Drop for ProjectWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
