import { useEffect, useRef, useState } from "react";
import { commands, NodeKind, Status } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

const KINDS: NodeKind[] = [
  "system",
  "service",
  "module",
  "flow_step",
  "task",
  "note",
];

const STATUSES: { value: Status; label: string; activeClass: string }[] = [
  {
    value: "planned",
    label: "Planned",
    activeClass: "border-slate-500 bg-slate-800 text-slate-100",
  },
  {
    value: "in_progress",
    label: "In Progress",
    activeClass: "border-amber-500/70 bg-amber-500/20 text-amber-200",
  },
  {
    value: "blocked",
    label: "Blocked",
    activeClass: "border-rose-500/70 bg-rose-500/20 text-rose-200",
  },
  {
    value: "done",
    label: "Done",
    activeClass: "border-emerald-500/70 bg-emerald-500/20 text-emerald-200",
  },
];

export function NodeInspector() {
  const {
    graph,
    selectedNodeId,
    viewMode,
    setSelection,
    updateNode,
    setCurrentParentId,
    copyNodeContext,
  } = useProjectStore();

  const node = graph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const [spec, setSpec] = useState("");
  const [specLoading, setSpecLoading] = useState(false);
  const [newFile, setNewFile] = useState("");
  const specSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!selectedNodeId) {
      setSpec("");
      return;
    }
    let cancelled = false;
    setSpecLoading(true);
    commands
      .readNodeSpec(selectedNodeId)
      .then((content) => {
        if (!cancelled) {
          setSpec(content);
          setSpecLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSpecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  if (!node) return null;

  const handleSpecChange = (value: string) => {
    setSpec(value);
    const id = node.id;
    if (specSaveTimerRef.current) clearTimeout(specSaveTimerRef.current);
    specSaveTimerRef.current = setTimeout(() => {
      commands.writeNodeSpec(id, value).catch(() => {});
    }, 350);
  };

  const handleAddLinkedFile = () => {
    const trimmed = newFile.trim();
    if (!trimmed) return;
    if (!node.linked_files.includes(trimmed)) {
      updateNode(node.id, {
        linked_files: [...node.linked_files, trimmed],
      });
    }
    setNewFile("");
  };

  const handleRemoveLinkedFile = (file: string) => {
    updateNode(node.id, {
      linked_files: node.linked_files.filter((f) => f !== file),
    });
  };

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-slate-400">
            {node.id}
          </div>
          <div className="truncate text-sm font-semibold text-slate-100">
            Node Inspector
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => copyNodeContext(node.id)}
            title="Copy scoped node context (Ctrl+Shift+C)"
            className="cursor-pointer rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            Copy Context
          </button>
          <button
            type="button"
            onClick={() => setSelection(null, null)}
            className="cursor-pointer rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <div>
          <label className="mb-1 block font-medium text-slate-300">Title</label>
          <input
            type="text"
            value={node.title}
            onChange={(e) => updateNode(node.id, { title: e.target.value })}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-medium text-slate-300">Kind</label>
            <select
              value={node.kind}
              onChange={(e) =>
                updateNode(node.id, { kind: e.target.value as NodeKind })
              }
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          {viewMode === "nested" && (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setCurrentParentId(node.id)}
                className="w-full cursor-pointer rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-slate-800"
              >
                Open Layer →
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block font-medium text-slate-300">
            Status
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {STATUSES.map((s) => {
              const active = node.status === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => updateNode(node.id, { status: s.value })}
                  className={`cursor-pointer rounded-md border px-2 py-1.5 text-left text-xs font-medium transition ${
                    active
                      ? s.activeClass
                      : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block font-medium text-slate-300">
            Summary
          </label>
          <textarea
            rows={2}
            value={node.summary}
            onChange={(e) => updateNode(node.id, { summary: e.target.value })}
            placeholder="Concise summary for agents and neighbors..."
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-slate-300">
            Linked Files
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newFile}
              onChange={(e) => setNewFile(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddLinkedFile();
                }
              }}
              placeholder="e.g. src/api/auth.rs"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleAddLinkedFile}
              className="cursor-pointer rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              Add
            </button>
          </div>
          {node.linked_files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {node.linked_files.map((file) => (
                <li
                  key={file}
                  className="flex items-center justify-between rounded bg-slate-950/80 px-2 py-1 font-mono text-[11px] text-slate-300"
                >
                  <span className="truncate">{file}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveLinkedFile(file)}
                    className="ml-2 cursor-pointer text-slate-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col">
          <div className="mb-1 flex items-center justify-between">
            <label className="font-medium text-slate-300">
              Spec (<code className="text-slate-400">specs/{node.id}.md</code>)
            </label>
            {specLoading && (
              <span className="text-[10px] text-slate-500">Loading…</span>
            )}
          </div>
          <textarea
            rows={9}
            value={spec}
            onChange={(e) => handleSpecChange(e.target.value)}
            placeholder="# Specification&#10;&#10;Acceptance criteria, edge cases, and agent instructions..."
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </aside>
  );
}
