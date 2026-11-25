# Tauri IPC & Watcher Bridge

Bridges `bloxd-core` to the React frontend via `tauri-specta` commands and the `bloxd://graph-updated` event.

## Key Behaviors
- Suppresses self-triggered watcher echoes within 600 ms of internal UI writes.
- Runs `auto_place_missing_nodes` before emitting external graph updates.
