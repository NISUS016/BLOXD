import { memo, useState } from "react";
import { Handle, NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
  BloxdNode as BloxdNodeModel,
  ChecklistProgress,
  NodeKind,
  Status,
} from "../bindings";

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
  checklist?: ChecklistProgress;
  driftCount?: number;
  isGroupContainer?: boolean;
  externalIn?: ExternalEdgeRef[];
  externalOut?: ExternalEdgeRef[];
  onOpenLayer?: (nodeId: string) => void;
  onJumpToNode?: (nodeId: string) => void;
  onResizeNode?: (
    nodeId: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => void;
  onAcceptProposal?: (nodeId: string) => void;
  onRejectProposal?: (nodeId: string) => void;
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
    checklist,
    driftCount = 0,
    isGroupContainer,
    externalIn = [],
    externalOut = [],
    onOpenLayer,
    onJumpToNode,
    onResizeNode,
    onAcceptProposal,
    onRejectProposal,
  } = data as BloxdFlowNodeData;
  const statusStyle = STATUS_STYLES[model.status] ?? STATUS_STYLES.planned;
  const kindStyle = KIND_STYLES[model.kind] ?? KIND_STYLES.module;
  const [popoverKind, setPopoverKind] = useState<"in" | "out" | null>(null);

  const activeList = popoverKind === "in" ? externalIn : externalOut;
  const constraintCount = model.constraints?.length ?? 0;
  const isProposed = Boolean(model.proposed);

  return (
    <div className="group relative h-full w-full">
      <NodeResizer
        minWidth={200}
        minHeight={100}
        isVisible={selected}
        lineClassName="!border-blue-500/60"
        handleClassName="!h-2.5 !w-2.5 !rounded-xs !border !border-slate-950 !bg-blue-400"
        onResizeEnd={(_, params) =>
          onResizeNode?.(model.id, {
            x: Math.round(params.x),
            y: Math.round(params.y),
            width: Math.round(params.width),
            height: Math.round(params.height),
          })
        }
      />
      {/* 4-sided connection handles (works with ConnectionMode.Loose) */}
      <Handle id="top" type="source" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="right" type="source" position={Position.Right} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      <Handle id="left" type="source" position={Position.Left} className={HANDLE_CLASS} />

      {/* Bounded card surface so inner text/badges never overflow card bounds */}
      <div
        className={`relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border p-3 shadow-lg transition ${
          isProposed
            ? "border-dashed border-sky-400/75 bg-slate-900/60 opacity-85 backdrop-blur-sm"
            : `bg-slate-900/95 ${statusStyle.border}`
        } ${selected ? "ring-2 ring-blue-500" : ""} ${
          isGroupContainer && !isProposed ? "bg-slate-900/50 backdrop-blur-sm" : ""
        }`}
      >
        {/* Kind color accent strip */}
        <div
          className={`absolute inset-x-0 top-0 h-0.5 ${
            isProposed ? "bg-sky-400/70" : kindStyle.accentBar
          }`}
        />

        {/* Header row */}
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-1.5 pt-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className={`truncate rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${kindStyle.badge}`}
            >
              {model.kind.replace("_", " ")}
            </span>
            {isProposed && (
              <span
                title={model.proposal_note ?? "Proposed by AI agent"}
                className="shrink-0 rounded border border-dashed border-sky-400/60 bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-sky-300"
              >
                PROPOSED
              </span>
            )}
            {driftCount > 0 && (
              <span
                title={`${driftCount} linked file(s) changed since last sync`}
                className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/40"
              >
                Δ {driftCount}
              </span>
            )}
          </div>
          {isProposed ? (
            <div
              className="nodrag nopan flex shrink-0 items-center gap-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptProposal?.(model.id);
                }}
                title="Accept proposed node"
                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-emerald-500/50 bg-emerald-500/20 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/40"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRejectProposal?.(model.id);
                }}
                title="Reject and remove proposed node"
                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-rose-500/50 bg-rose-500/20 text-[11px] font-bold text-rose-300 transition hover:bg-rose-500/40"
              >
                ✕
              </button>
            </div>
          ) : (
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
          )}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden py-1.5">
          <div
            title={model.title}
            className="truncate text-sm font-semibold text-slate-100"
          >
            {model.title}
          </div>

          {isProposed && model.proposal_note ? (
            <p
              title={model.proposal_note}
              className="mt-0.5 line-clamp-2 text-xs italic leading-snug text-sky-300/90"
            >
              {model.proposal_note}
            </p>
          ) : (
            model.summary && (
              <p
                title={model.summary}
                className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-400"
              >
                {model.summary}
              </p>
            )
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
            {externalIn.length === 0 &&
              externalOut.length === 0 &&
              (!checklist || checklist.total === 0) &&
              constraintCount === 0 && (
                <span
                  title={model.id}
                  className="truncate font-mono text-[10px] text-slate-500"
                >
                  {model.id}
                </span>
              )}
            {checklist && checklist.total > 0 && (
              <span
                title={`Spec checklist: ${checklist.done}/${checklist.total} done`}
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  checklist.done === checklist.total
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                ☑ {checklist.done}/{checklist.total}
              </span>
            )}
            {constraintCount > 0 && (
              <span
                title={`${constraintCount} architectural constraint(s)`}
                className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
              >
                ⚑ {constraintCount}
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
