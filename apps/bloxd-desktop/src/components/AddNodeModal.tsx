import { FormEvent, useState } from "react";
import { NodeKind } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

interface AddNodeModalProps {
  open: boolean;
  onClose: () => void;
}

const NODE_KINDS: NodeKind[] = [
  "system",
  "service",
  "module",
  "flow_step",
  "task",
  "note",
];

export function AddNodeModal({ open, onClose }: AddNodeModalProps) {
  const { addNode, currentParentId } = useProjectStore();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<NodeKind>("module");
  const [summary, setSummary] = useState("");

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    addNode({
      title: title.trim(),
      kind,
      summary: summary.trim(),
      parentId: currentParentId,
    });
    setTitle("");
    setSummary("");
    setKind("module");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-slate-100">
          Add Node {currentParentId ? `to ${currentParentId}` : "(Root Layer)"}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Title
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Auth Service"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Kind
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as NodeKind)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
            >
              {NODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Summary
            </label>
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short description of responsibilities..."
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="cursor-pointer rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Create Node
          </button>
        </div>
      </form>
    </div>
  );
}
