import { useEffect, useMemo, useRef, useState } from "react";
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

interface ChecklistItem {
  lineIndex: number;
  done: boolean;
  text: string;
}

function parseChecklistItems(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const t = line.trimStart();
    const rest = t.startsWith("- ") ? t.slice(2) : t.startsWith("* ") ? t.slice(2) : null;
    if (!rest) return;
    if (rest.startsWith("[ ] ")) {
      items.push({ lineIndex: idx, done: false, text: rest.slice(4) });
    } else if (rest.startsWith("[x] ") || rest.startsWith("[X] ")) {
      items.push({ lineIndex: idx, done: true, text: rest.slice(4) });
    }
  });
  return items;
}

export function NodeInspector() {
  const {
    graph,
    drift,
    inspectedNodeId,
    openInspector,
    updateNode,
    setViewMode,
    setCurrentParentId,
    updateSpecChecklist,
    markSynced,
    copyNodeContext,
  } = useProjectStore();

  const node = graph?.nodes.find((n) => n.id === inspectedNodeId) ?? null;

  const [spec, setSpec] = useState("");
  const [specLoading, setSpecLoading] = useState(false);
  const [newFile, setNewFile] = useState("");
  const [newConstraint, setNewConstraint] = useState("");
  const specSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!inspectedNodeId) {
      setSpec("");
      return;
    }
    let cancelled = false;
    setSpecLoading(true);
    commands
      .readNodeSpec(inspectedNodeId)
      .then((content) => {
        if (!cancelled) {
          setSpec(content);
          updateSpecChecklist(inspectedNodeId, content);
          setSpecLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSpecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inspectedNodeId, updateSpecChecklist]);

  const checklistItems = useMemo(() => parseChecklistItems(spec), [spec]);

  if (!node) return null;

  const driftedFiles = drift?.drifted?.[node.id] ?? [];

  const handleSpecChange = (value: string) => {
    setSpec(value);
    const id = node.id;
    updateSpecChecklist(id, value);
    if (specSaveTimerRef.current) clearTimeout(specSaveTimerRef.current);
    specSaveTimerRef.current = setTimeout(() => {
      commands.writeNodeSpec(id, value).catch(() => {});
    }, 350);
  };

  const handleToggleChecklist = (lineIndex: number) => {
    const lines = spec.split(/\r?\n/);
    const line = lines[lineIndex];
    if (!line) return;
    if (line.includes("[ ] ")) {
      lines[lineIndex] = line.replace("[ ] ", "[x] ");
    } else if (line.includes("[x] ")) {
      lines[lineIndex] = line.replace("[x] ", "[ ] ");
    } else if (line.includes("[X] ")) {
      lines[lineIndex] = line.replace("[X] ", "[ ] ");
    }
    handleSpecChange(lines.join("\n"));
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

  const constraints = node.constraints ?? [];

  const handleAddConstraint = () => {
    const trimmed = newConstraint.trim();
    if (!trimmed) return;
    if (!constraints.includes(trimmed)) {
      updateNode(node.id, {
        constraints: [...constraints, trimmed],
      });
    }
    setNewConstraint("");
  };

  const handleRemoveConstraint = (item: string) => {
    updateNode(node.id, {
      constraints: constraints.filter((c) => c !== item),
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
            onClick={() => openInspector(null)}
            className="cursor-pointer rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {driftedFiles.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-2.5 text-amber-200">
            <div className="flex items-center justify-between font-semibold">
              <span>Δ {driftedFiles.length} linked file(s) drifted</span>
              <button
                type="button"
                onClick={() => markSynced([node.id])}
                className="cursor-pointer rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/30"
              >
                Mark Synced
              </button>
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-amber-300/90">
              {driftedFiles.map((f) => (
                <li key={f} className="truncate">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

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

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setViewMode("nested");
                setCurrentParentId(node.id);
              }}
              className="w-full cursor-pointer rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-slate-800"
            >
              Open Layer →
            </button>
          </div>
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
            Constraints / ADRs
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newConstraint}
              onChange={(e) => setNewConstraint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddConstraint();
                }
              }}
              placeholder="e.g. Must use atomic writes on Windows"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleAddConstraint}
              className="cursor-pointer rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              Add
            </button>
          </div>
          {constraints.length > 0 && (
            <ul className="mt-2 space-y-1">
              {constraints.map((c) => (
                <li
                  key={c}
                  className="flex items-start justify-between gap-2 rounded bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200 ring-1 ring-amber-500/20"
                >
                  <span>⚑ {c}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveConstraint(c)}
                    className="cursor-pointer text-slate-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
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

        {checklistItems.length > 0 && (
          <div>
            <label className="mb-1.5 block font-medium text-slate-300">
              Spec Checklist ({checklistItems.filter((i) => i.done).length}/
              {checklistItems.length})
            </label>
            <div className="space-y-1 rounded-md border border-slate-800 bg-slate-950/60 p-2">
              {checklistItems.map((item) => (
                <label
                  key={item.lineIndex}
                  className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => handleToggleChecklist(item.lineIndex)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span className={item.done ? "text-slate-500 line-through" : ""}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

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
            rows={8}
            value={spec}
            onChange={(e) => handleSpecChange(e.target.value)}
            placeholder="# Specification&#10;&#10;- [ ] First task&#10;- [x] Done task"
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </aside>
  );
}
