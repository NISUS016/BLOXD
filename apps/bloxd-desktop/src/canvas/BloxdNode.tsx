import { memo, useState } from "react";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { BloxdNode as BloxdNodeModel, NodeKind, Status } from "../bindings";

export interface ExternalEdgeRef {
  edgeId: string;
  nodeId: string;
  title: string;
  label: string | null;
  parentId: string | null;
}

export interface BloxdFlowNodeData extends Record<string, unknown> {
  model: BloxdNodeModel;
  childCount: number;
  doneCount: number;
  isGroupContainer?: boolean;
  externalIn?: ExternalEdgeRef[];
  externalOut?: ExternalEdgeRef[];
  onOpenLayer?: (nodeId: string) => void;
  onJumpToNode?: (nodeId: string) => void;
}

const STATUS_STYLES: Record<
  Status,
  { border: string; dot: string; label: string; badge?: string }
> = {
  planned: {
    border: "border-slate-700",
    dot: "bg-slate-400",
    label: "planned",
  },
  in_progress: {
    border: "border-amber-400/90 ring-2 ring-amber-400/30",
    dot: "bg-amber-400 animate-pulse",
    label: "in progress",
  },
  blocked: {
    border: "border-rose-500/90 ring-1 ring-rose-500/30",
    dot: "bg-rose-500",
    label: "blocked",
    badge: "!",
  },
  done: {
    border: "border-emerald-500/70",
    dot: "bg-emerald-400",
    label: "done",
    badge: "✓",
  },
};

const KIND_STYLES: Record<
  NodeKind,
  { badge: string; accentBar: string }
> = {
  system: {
    badge: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30",
    accentBar: "bg-blue-500",
  },
  service: {
    badge: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30",
    accentBar: "bg-violet-500",
  },
  module: {
    badge: "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30",
    accentBar: "bg-cyan-500",
  },
  flow_step: {
    badge: "bg-pink-500/15 text-pink-300 ring-1 ring-pink-500/30",
    accentBar: "bg-pink-500",
  },
  task: {
    badge: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    accentBar: "bg-amber-500",
  },
  note: {
    badge: "bg-slate-700/60 text-slate-300 ring-1 ring-slate-600/40",
    accentBar: "bg-slate-500",
  },
};

const HANDLE_CLASS =
  "!h-2.5 !w-2.5 !border-2 !border-slate-900 !bg-slate-400 transition hover:!scale-125 hover:!bg-blue-400";

export const BloxdNode = memo(function BloxdNode({
  data,
  selected,
}: NodeProps) {
  const {
    model,
    childCount,
    doneCount,
    isGroupContainer,
    externalIn = [],
    externalOut = [],
    onOpenLayer,
    onJumpToNode,
  } = data as BloxdFlowNodeData;
  const statusStyle = STATUS_STYLES[model.status] ?? STATUS_STYLES.planned;
  const kindStyle = KIND_STYLES[model.kind] ?? KIND_STYLES.module;
  const [popoverKind, setPopoverKind] = useState<"in" | "out" | null>(null);

  const activeList = popoverKind === "in" ? externalIn : externalOut;

  return (
    <div className="group relative h-full w-full">
      {/* 4-sided connection handles (works with ConnectionMode.Loose) */}
      <Handle id="top" type="source" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="right" type="source" position={Position.Right} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <Handle id="left" type="source" position={Position.Left} className={HANDLE_CLASS} />

      {/* Bounded card surface so inner text/badges never overflow card bounds */}
      <div
        className={`relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-slate-900/95 p-3 shadow-lg transition ${
          statusStyle.border
        } ${selected ? "ring-2 ring-blue-500" : ""} ${
          isGroupContainer ? "bg-slate-900/50 backdrop-blur-sm" : ""
        }`}
      >
        {/* Kind color accent strip */}
        <div className={`absolute inset-x-0 top-0 h-0.5 ${kindStyle.accentBar}`} />

        {/* Header row */}
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 pt-0.5">
          <span
            className={`truncate rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${kindStyle.badge}`}
          >
            {model.kind.replace("_", " ")}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
            <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
            {statusStyle.label}
            {statusStyle.badge && (
              <span
                className={`ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold ${
                  model.status === "done"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {statusStyle.badge}
              </span>
            )}
          </span>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden py-1.5">
          <div
            title={model.title}
            className="truncate text-sm font-semibold text-slate-100"
          >
            {model.title}
          </div>

          {model.summary && (
            <p
              title={model.summary}
              className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-400"
            >
              {model.summary}
            </p>
          )}
        </div>

        {/* Dedicated footer bar */}
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-1.5 border-t border-slate-800/80 pt-1.5">
          <div className="flex min-w-0 items-center gap-1">
            {externalIn.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverKind((prev) => (prev === "in" ? null : "in"));
                }}
                title="External incoming cross-layer links"
                className="nodrag shrink-0 cursor-pointer rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 transition hover:bg-cyan-900/60"
              >
                ↙ {externalIn.length}
              </button>
            )}
            {externalOut.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverKind((prev) => (prev === "out" ? null : "out"));
                }}
                title="External outgoing cross-layer links"
                className="nodrag shrink-0 cursor-pointer rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-violet-300 transition hover:bg-violet-900/60"
              >
                ↗ {externalOut.length}
              </button>
            )}
            {externalIn.length === 0 && externalOut.length === 0 && (
              <span
                title={model.id}
                className="truncate font-mono text-[10px] text-slate-500"
              >
                {model.id}
              </span>
            )}
          </div>

          {onOpenLayer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLayer(model.id);
              }}
              title="Click to open nested layer"
              className="nodrag shrink-0 cursor-pointer whitespace-nowrap rounded bg-slate-800/90 px-2 py-0.5 text-[10px] font-medium text-blue-300 transition hover:bg-blue-600 hover:text-white"
            >
              {childCount > 0 ? `${doneCount}/${childCount} · Open` : "Open Layer"}
            </button>
          )}
        </div>
      </div>

      {/* Rendered outside overflow-hidden surface so popover is never clipped */}
      {popoverKind && activeList.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan absolute left-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>
              {popoverKind === "in"
                ? "Incoming External Links"
                : "Outgoing External Links"}
            </span>
            <button
              type="button"
              onClick={() => setPopoverKind(null)}
              className="cursor-pointer text-slate-500 hover:text-slate-200"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {activeList.map((ref) => (
              <button
                key={ref.edgeId}
                type="button"
                onClick={() => {
                  setPopoverKind(null);
                  onJumpToNode?.(ref.nodeId);
                }}
                className="flex w-full cursor-pointer items-center justify-between rounded bg-slate-950/80 px-2 py-1.5 text-left text-xs transition hover:bg-slate-800"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">
                    {ref.title}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {ref.label ? `${ref.label} · ` : ""}
                    {ref.parentId ? `in ${ref.parentId}` : "root"}
                  </div>
                </div>
                <span className="ml-2 shrink-0 text-[10px] font-medium text-blue-400">
                  Jump →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
