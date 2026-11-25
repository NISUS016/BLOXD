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
    viewMode,
    layoutDirection,
    snapToGrid,
    selectedNodeId,
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
    copyNodeContext,
  } = useProjectStore();

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
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2.5">
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

      <div className="flex items-center gap-2">
        {graph && (
          <>
            <button
              type="button"
              onClick={onOpenPalette}
              title="Quick jump / add (Ctrl+K)"
              className="cursor-pointer rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
            >
              Jump… <kbd className="ml-1 text-[10px] text-slate-500">Ctrl+K</kbd>
            </button>

            <button
              type="button"
              onClick={onOpenAddNode}
              className="cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              + Add Node
            </button>

            {viewMode !== "graph" && (
              <>
                <div className="flex items-center overflow-hidden rounded-md border border-slate-800 bg-slate-900 text-xs">
                  <button
                    type="button"
                    onClick={() => autoLayoutCurrentLayer(layoutDirection)}
                    title={`Arrange nodes with Dagre (${layoutDirection})`}
                    className="cursor-pointer px-2.5 py-1.5 font-medium text-slate-200 transition hover:bg-slate-800"
                  >
                    Auto-Layout
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLayoutDirection(nextDirection);
                      autoLayoutCurrentLayer(nextDirection);
                    }}
                    title="Switch Dagre direction (LR / TB)"
                    className="cursor-pointer border-l border-slate-800 px-2 py-1.5 font-mono text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                  >
                    {layoutDirection}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={toggleSnapToGrid}
                  title="Toggle 20px Snap-to-Grid"
                  className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                    snapToGrid
                      ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                      : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Snap
                </button>
              </>
            )}

            {selectedNodeId && (
              <button
                type="button"
                onClick={() => copyNodeContext(selectedNodeId)}
                title="Copy scoped node context (Ctrl+Shift+C)"
                className="cursor-pointer rounded-md border border-blue-500/40 bg-blue-950/40 px-2.5 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-blue-900/60"
              >
                Copy Context
              </button>
            )}

            {(selectedNodeId || selectedEdgeId) && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="cursor-pointer rounded-md border border-rose-500/40 bg-rose-950/40 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-900/60"
              >
                Delete {selectedNodeId ? "Node" : "Edge"}
              </button>
            )}

            <div className="ml-1 flex rounded-md border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("nested")}
                className={`cursor-pointer rounded px-2.5 py-1 font-medium transition ${
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
                className={`cursor-pointer rounded px-2.5 py-1 font-medium transition ${
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
                className={`cursor-pointer rounded px-2.5 py-1 font-medium transition ${
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
          className="cursor-pointer rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Opening…" : "Open Project"}
        </button>
      </div>
    </header>
  );
}
