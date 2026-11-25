import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenAddNode: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenAddNode,
}: CommandPaletteProps) {
  const { graph, jumpToNode } = useProjectStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const matches = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    if (!q) return graph.nodes.slice(0, 12);
    return graph.nodes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          n.kind.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [graph, query]);

  if (!open || !graph) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center border-b border-slate-800 px-3">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && matches.length > 0) {
                jumpToNode(matches[0].id);
                onClose();
              }
            }}
            placeholder="Jump to node by name, id, or kind…"
            className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAddNode();
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-blue-300 hover:bg-slate-800"
          >
            <span>+ Add new node in current layer</span>
            <span className="text-[10px] text-slate-500">Action</span>
          </button>

          {matches.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                jumpToNode(n.id);
                onClose();
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-800"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-100">
                  {n.title}
                </div>
                <div className="truncate font-mono text-[10px] text-slate-500">
                  {n.id} {n.parent_id ? `· in ${n.parent_id}` : "· root"}
                </div>
              </div>
              <span className="ml-3 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {n.status.replace("_", " ")}
              </span>
            </button>
          ))}

          {matches.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">
              No matching nodes
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
