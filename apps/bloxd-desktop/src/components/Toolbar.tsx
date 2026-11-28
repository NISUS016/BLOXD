import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../store/useProjectStore";

interface ToolbarProps {
  onOpenAddNode: () => void;
  onOpenPalette: () => void;
}

export function Toolbar({ onOpenAddNode, onOpenPalette }: ToolbarProps) {
  const {
    projectPath,
    graph,
    drift,
    viewMode,
    layoutDirection,
    snapToGrid,
    selectedNodeId,
    selectedNodeIds,
    selectedEdgeId,
    loading,
    saving,
    openProject,
    setViewMode,
    setLayoutDirection,
    toggleSnapToGrid,
    autoLayoutCurrentLayer,
    deleteNode,
    deleteEdge,
    copySelectedContext,
    checkDrift,
    markSynced,
    copyDriftSyncPrompt,
    jumpToNode,
  } = useProjectStore();

  const [driftOpen, setDriftOpen] = useState(false);

  const driftedEntries = Object.entries(drift?.drifted ?? {});
  const driftedCount = driftedEntries.length;

  const handleOpenFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder for .bloxd/",
    });
    if (typeof selected === "string") {
      await openProject(selected);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedNodeId) {
      deleteNode(selectedNodeId);
    } else if (selectedEdgeId) {
      deleteEdge(selectedEdgeId);
    }
  };

  const nextDirection = layoutDirection === "LR" ? "TB" : "LR";

  return (
    <header className="relative flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="rounded bg-blue-500/15 px-2 py-0.5 font-mono text-sm font-semibold text-blue-400">
          bloxd
        </span>
        {graph ? (
          <>
            <span className="text-sm font-medium text-slate-200">
              {graph.project}
            </span>
            <span
              className="max-w-xs truncate text-xs text-slate-500"
              title={projectPath ?? ""}
            >
              {projectPath}
            </span>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-slate-800">
              {saving ? "Saving…" : "Saved"}
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-400">No project opened</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {graph && (
          <>
            <button
              type="button"
              onClick={onOpenPalette}
              title="Quick jump / add (Ctrl+K)"
              className="inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-slate-800 bg-slate-900 px-2.5 text-xs text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
            >
              Jump… <kbd className="ml-1.5 text-[10px] text-slate-500">Ctrl+K</kbd>
            </button>

            <button
              type="button"
              onClick={onOpenAddNode}
              className="inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              + Add Node
            </button>

            {viewMode !== "graph" && (
              <>
                <div className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-xs">
                    <button
                    type="button"
                    onClick={() => autoLayoutCurrentLayer(layoutDirection)}
                    title={`Arrange nodes cleanly with ELK (${layoutDirection})`}
                    className="inline-flex h-full cursor-pointer items-center whitespace-nowrap px-2.5 font-medium text-slate-200 transition hover:bg-slate-800"
                  >
                    Auto-Layout
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLayoutDirection(nextDirection);
                      autoLayoutCurrentLayer(nextDirection);
                    }}
                    title="Switch ELK layout direction (LR / TB)"
                    className="inline-flex h-full cursor-pointer items-center whitespace-nowrap border-l border-slate-800 px-2 font-mono text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                  >
                    {layoutDirection}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={toggleSnapToGrid}
                  title="Toggle 20px Snap-to-Grid"
                  className={`inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition ${
                    snapToGrid
                      ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                      : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Snap
                </button>
              </>
            )}

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await checkDrift();
                  setDriftOpen((v) => !v);
                }}
                title="Check Git drift against linked_files"
                className={`inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition ${
                  driftedCount > 0
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
                }`}
              >
                {driftedCount > 0 ? `Drift Δ ${driftedCount}` : "Check Drift"}
              </button>

              {driftOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-100">
                      Git Drift Status
                    </span>
                    <button
                      type="button"
                      onClick={() => setDriftOpen(false)}
                      className="cursor-pointer text-xs text-slate-400 hover:text-slate-200"
                    >
                      ✕
                    </button>
                  </div>

                  {!drift?.is_git_repo ? (
                    <p className="text-xs text-slate-400">
                      Not a Git repository (drift detection disabled).
                    </p>
                  ) : driftedCount === 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-emerald-300">
                        All linked files are in sync with{" "}
                        <code className="text-[10px] text-slate-400">
                          {drift.head_commit?.slice(0, 7)}
                        </code>
                        .
                      </p>
                      <button
                        type="button"
                        onClick={() => markSynced([])}
                        className="cursor-pointer rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                      >
                        Pin Baseline to HEAD
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="max-h-48 space-y-1.5 overflow-y-auto">
                        {driftedEntries.map(([nodeId, files]) => (
                          <div
                            key={nodeId}
                            className="rounded-md border border-slate-800 bg-slate-950/70 p-2 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => {
                                  jumpToNode(nodeId);
                                  setDriftOpen(false);
                                }}
                                className="cursor-pointer font-mono font-semibold text-amber-300 hover:underline"
                              >
                                {nodeId}
                              </button>
                              <span className="text-[10px] text-slate-400">
                                {files.length} file(s)
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[10px] text-slate-400">
                              {files.join(", ")}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            copyDriftSyncPrompt(driftedEntries.map(([id]) => id))
                          }
                          className="flex-1 cursor-pointer rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                        >
                          Copy Sync Prompt
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            markSynced(driftedEntries.map(([id]) => id))
                          }
                          className="cursor-pointer rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          Mark Synced
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedNodeIds.length > 0 && (
              <button
                type="button"
                onClick={() => copySelectedContext()}
                title="Copy scoped context (Ctrl+Shift+C)"
                className="inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-blue-500/40 bg-blue-950/40 px-2.5 text-xs font-medium text-blue-300 transition hover:bg-blue-900/60"
              >
                {selectedNodeIds.length >= 2
                  ? `Copy Slice (${selectedNodeIds.length})`
                  : "Copy Context"}
              </button>
            )}

            {(selectedNodeId || selectedEdgeId) && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-rose-500/40 bg-rose-950/40 px-2.5 text-xs font-medium text-rose-300 transition hover:bg-rose-900/60"
              >
                Delete {selectedNodeId ? "Node" : "Edge"}
              </button>
            )}

            <div className="inline-flex h-7 shrink-0 items-center rounded-md border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("nested")}
                className={`inline-flex h-full cursor-pointer items-center whitespace-nowrap rounded px-2.5 font-medium transition ${
                  viewMode === "nested"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Nested
              </button>
              <button
                type="button"
                onClick={() => setViewMode("unified")}
                className={`inline-flex h-full cursor-pointer items-center whitespace-nowrap rounded px-2.5 font-medium transition ${
                  viewMode === "unified"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Unified
              </button>
              <button
                type="button"
                onClick={() => setViewMode("graph")}
                className={`inline-flex h-full cursor-pointer items-center whitespace-nowrap rounded px-2.5 font-medium transition ${
                  viewMode === "graph"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Graph
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={handleOpenFolder}
          disabled={loading}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Opening…" : "Open Project"}
        </button>
      </div>
    </header>
  );
}
