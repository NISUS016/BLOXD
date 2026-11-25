import { BloxdNode } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

export function Breadcrumbs() {
  const { graph, currentParentId, viewMode, setCurrentParentId } =
    useProjectStore();

  if (!graph) return null;

  if (viewMode === "unified") {
    return (
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-400">
        <span className="rounded bg-blue-500/15 px-2 py-0.5 font-medium text-blue-300">
          Unified Overview
        </span>
        <span>Showing all layers with parent-child grouping</span>
      </div>
    );
  }

  if (viewMode === "graph") {
    return (
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-400">
        <span className="rounded bg-violet-500/15 px-2 py-0.5 font-medium text-violet-300">
          Graph View
        </span>
        <span>
          Click a node to inspect · Double-click to jump to its Nested layer
        </span>
      </div>
    );
  }

  const byId = new Map<string, BloxdNode>(graph.nodes.map((n) => [n.id, n]));
  const trail: BloxdNode[] = [];
  let cursor = currentParentId;
  const guard = new Set<string>();

  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    trail.unshift(node);
    cursor = node.parent_id;
  }

  return (
    <nav
      aria-label="Layer breadcrumbs"
      className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-xs"
    >
      <button
        type="button"
        onClick={() => setCurrentParentId(null)}
        className={`cursor-pointer rounded px-1.5 py-0.5 transition ${
          currentParentId === null
            ? "bg-slate-800 font-semibold text-slate-100"
            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        }`}
      >
        Root
      </button>

      {trail.map((node, idx) => {
        const isLast = idx === trail.length - 1;
        return (
          <div key={node.id} className="flex items-center gap-1.5">
            <span className="text-slate-600">/</span>
            <button
              type="button"
              onClick={() => setCurrentParentId(node.id)}
              className={`cursor-pointer rounded px-1.5 py-0.5 transition ${
                isLast
                  ? "bg-slate-800 font-semibold text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              {node.title}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
