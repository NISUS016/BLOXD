import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, ProjectSnapshot } from "./bindings";
import { ArchitectureCanvas } from "./canvas/ArchitectureCanvas";
import { ObsidianGraph } from "./canvas/ObsidianGraph";
import { AddNodeModal } from "./components/AddNodeModal";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { CommandPalette } from "./components/CommandPalette";
import { Toast } from "./components/Toast";
import { Toolbar } from "./components/Toolbar";
import { NodeInspector } from "./inspector/NodeInspector";
import { useProjectStore } from "./store/useProjectStore";

export function App() {
  const {
    graph,
    viewMode,
    loading,
    error,
    selectedNodeId,
    selectedNodeIds,
    openProject,
    applyExternalSnapshot,
    ascendLayer,
    goBackLayer,
    goForwardLayer,
    undo,
    redo,
    copySelectedContext,
  } = useProjectStore();
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Open initial project if launched via `bloxd open <path>` (--open <path>)
  useEffect(() => {
    commands
      .getInitialProject()
      .then((initialPath) => {
        if (initialPath) {
          openProject(initialPath);
        }
      })
      .catch(() => {});
  }, [openProject]);

  // Listen for live `.bloxd/` edits from AI agents on disk
  useEffect(() => {
    const unlistenPromise = listen<ProjectSnapshot>(
      "bloxd://graph-updated",
      (event) => {
        applyExternalSnapshot(event.payload);
      }
    );
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applyExternalSnapshot]);

  // Global keyboard & Mouse4/Mouse5 navigation shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "c" &&
        (selectedNodeIds.length > 0 || selectedNodeId)
      ) {
        e.preventDefault();
        copySelectedContext();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !isTyping) {
        const lower = e.key.toLowerCase();
        if (lower === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((lower === "z" && e.shiftKey) || lower === "y") {
          e.preventDefault();
          redo();
          return;
        }
      }

      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBackLayer();
        return;
      }

      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForwardLayer();
        return;
      }

      if (e.key === "Backspace" && !isTyping) {
        e.preventDefault();
        ascendLayer();
      }
    };

    const blockSideButtonDefault = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        goBackLayer();
      } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        goForwardLayer();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", blockSideButtonDefault, true);
    window.addEventListener("auxclick", blockSideButtonDefault, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", blockSideButtonDefault, true);
      window.removeEventListener("auxclick", blockSideButtonDefault, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [
    ascendLayer,
    copySelectedContext,
    goBackLayer,
    goForwardLayer,
    redo,
    selectedNodeId,
    selectedNodeIds,
    undo,
  ]);

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <Toolbar
        onOpenAddNode={() => setAddNodeOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <Breadcrumbs />

      {error && (
        <div className="border-b border-rose-500/40 bg-rose-950/60 px-4 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {!graph ? (
        <main className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold text-slate-100">
              Architecture Canvas for AI Coding Agents
            </h1>
            <p className="mb-6 text-sm text-slate-400">
              Open any repository folder to load or initialize its{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                .bloxd/
              </code>{" "}
              directory.
            </p>
            <button
              type="button"
              onClick={handleOpenFolder}
              disabled={loading}
              className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-blue-500 hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Opening…" : "Select Folder…"}
            </button>
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          {viewMode === "graph" ? (
            <ObsidianGraph />
          ) : (
            <ArchitectureCanvas onRequestAddNode={() => setAddNodeOpen(true)} />
          )}
          <NodeInspector />
        </div>
      )}

      <AddNodeModal open={addNodeOpen} onClose={() => setAddNodeOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenAddNode={() => setAddNodeOpen(true)}
      />
      <Toast />
    </div>
  );
}

export default App;
