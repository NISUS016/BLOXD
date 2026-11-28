import { memo, useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
  Position,
  useReactFlow,
} from "@xyflow/react";
import { EdgeRoute } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

interface BloxdEdgeData {
  curveOffset?: number;
  bypassOffset?: { x: number; y: number };
  labelOffset?: { x: number; y: number };
  elkRoute?: EdgeRoute;
  proposed?: boolean;
  proposalNote?: string | null;
}

interface Point {
  x: number;
  y: number;
}

const GRID_SIZE = 20;

/**
 * Converts a polyline of waypoints into an SVG path string with smooth rounded corners.
 */
function buildRoundedPolyline(rawPoints: Point[], radius = 10): string {
  // Collapse consecutive near-duplicate points
  const deduped: Point[] = [];
  for (const p of rawPoints) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5) {
      deduped.push(p);
    }
  }
  if (deduped.length < 2) {
    const p = rawPoints[0] ?? { x: 0, y: 0 };
    return `M ${p.x},${p.y}`;
  }

  // Collapse collinear intermediate vertices
  const pts: Point[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const a = pts[pts.length - 1];
    const b = deduped[i];
    const c = deduped[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 1e-2 && dot >= 0) {
      continue;
    }
    pts.push(b);
  }
  pts.push(deduped[deduped.length - 1]);

  if (pts.length === 2) {
    return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  }

  const parts: string[] = [`M ${pts[0].x},${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    const r = Math.min(radius, len1 * 0.45, len2 * 0.45);
    if (r < 0.75 || len1 < 0.5 || len2 < 0.5) {
      parts.push(`L ${curr.x},${curr.y}`);
      continue;
    }

    const inX = curr.x - (v1x / len1) * r;
    const inY = curr.y - (v1y / len1) * r;
    const outX = curr.x + (v2x / len2) * r;
    const outY = curr.y + (v2y / len2) * r;

    parts.push(`L ${inX},${inY} Q ${curr.x},${curr.y} ${outX},${outY}`);
  }

  const last = pts[pts.length - 1];
  parts.push(`L ${last.x},${last.y}`);
  return parts.join(" ");
}

function handleNormal(pos: Position): { dx: number; dy: number; isHoriz: boolean } {
  switch (pos) {
    case Position.Left:
      return { dx: -1, dy: 0, isHoriz: true };
    case Position.Right:
      return { dx: 1, dy: 0, isHoriz: true };
    case Position.Top:
      return { dx: 0, dy: -1, isHoriz: false };
    case Position.Bottom:
      return { dx: 0, dy: 1, isHoriz: false };
  }
}

/**
 * Builds a 90-degree rounded orthogonal path for ALL 16 handle combinations
 * such that the wire passes directly through `(cellX, cellY)`.
 */
function buildRoundedOrthoPath(
  sx: number,
  sy: number,
  sPos: Position,
  tx: number,
  ty: number,
  tPos: Position,
  cellX: number,
  cellY: number
): string {
  const sN = handleNormal(sPos);
  const tN = handleNormal(tPos);
  const stub = 22;

  const sOut: Point = { x: sx + sN.dx * stub, y: sy + sN.dy * stub };
  const tOut: Point = { x: tx + tN.dx * stub, y: ty + tN.dy * stub };

  const pts: Point[] = [{ x: sx, y: sy }];

  if (sN.isHoriz && tN.isHoriz) {
    // Horizontal -> Horizontal: exit horizontally, step vertically to cellY, cross horizontally through (cellX, cellY), step to ty
    const x1 =
      sN.dx > 0
        ? Math.max(sOut.x, sx + (cellX - sx) * 0.45)
        : Math.min(sOut.x, sx + (cellX - sx) * 0.45);
    const x2 =
      tN.dx > 0
        ? Math.max(tOut.x, tx + (cellX - tx) * 0.45)
        : Math.min(tOut.x, tx + (cellX - tx) * 0.45);
    pts.push(
      { x: x1, y: sy },
      { x: x1, y: cellY },
      { x: cellX, y: cellY },
      { x: x2, y: cellY },
      { x: x2, y: ty }
    );
  } else if (!sN.isHoriz && !tN.isHoriz) {
    // Vertical -> Vertical: exit vertically, cross horizontally at y1 to cellX, pass vertically through (cellX, cellY)
    const y1 =
      sN.dy > 0
        ? Math.max(sOut.y, sy + (cellY - sy) * 0.45)
        : Math.min(sOut.y, sy + (cellY - sy) * 0.45);
    const y2 =
      tN.dy > 0
        ? Math.max(tOut.y, ty + (cellY - ty) * 0.45)
        : Math.min(tOut.y, ty + (cellY - ty) * 0.45);
    pts.push(
      { x: sx, y: y1 },
      { x: cellX, y: y1 },
      { x: cellX, y: cellY },
      { x: cellX, y: y2 },
      { x: tx, y: y2 }
    );
  } else if (sN.isHoriz && !tN.isHoriz) {
    // Horizontal -> Vertical
    const x1 =
      sN.dx > 0
        ? Math.max(sOut.x, sx + (cellX - sx) * 0.45)
        : Math.min(sOut.x, sx + (cellX - sx) * 0.45);
    const y2 =
      tN.dy > 0
        ? Math.max(tOut.y, cellY)
        : Math.min(tOut.y, cellY);
    if (Math.abs(y2 - cellY) < 1) {
      // cellY is already on the entry side of tOut: go horizontally through (cellX, cellY) into tx, then vertically into ty
      pts.push(
        { x: x1, y: sy },
        { x: x1, y: cellY },
        { x: cellX, y: cellY },
        { x: tx, y: cellY }
      );
    } else {
      // cellY is behind the target handle: step to tOut.y outside target
      const midX = (cellX + tx) * 0.5;
      pts.push(
        { x: x1, y: sy },
        { x: x1, y: cellY },
        { x: cellX, y: cellY },
        { x: midX, y: cellY },
        { x: midX, y: tOut.y },
        { x: tx, y: tOut.y }
      );
    }
  } else {
    // Vertical -> Horizontal
    const y1 =
      sN.dy > 0
        ? Math.max(sOut.y, sy + (cellY - sy) * 0.45)
        : Math.min(sOut.y, sy + (cellY - sy) * 0.45);
    const x2 =
      tN.dx > 0
        ? Math.max(tOut.x, cellX)
        : Math.min(tOut.x, cellX);
    if (Math.abs(x2 - cellX) < 1) {
      pts.push(
        { x: sx, y: y1 },
        { x: cellX, y: y1 },
        { x: cellX, y: cellY },
        { x: cellX, y: ty }
      );
    } else {
      const midY = (cellY + ty) * 0.5;
      pts.push(
        { x: sx, y: y1 },
        { x: cellX, y: y1 },
        { x: cellX, y: cellY },
        { x: cellX, y: midY },
        { x: tOut.x, y: midY },
        { x: tOut.x, y: ty }
      );
    }
  }

  pts.push({ x: tx, y: ty });
  return buildRoundedPolyline(pts, 10);
}

/**
 * Builds a pure 45-degree octilinear PCB/circuit trace (only 0°, 45°, 90° segments)
 * passing directly through `(cellX, cellY)`.
 */
function buildCircuitPath(
  sx: number,
  sy: number,
  sPos: Position,
  tx: number,
  ty: number,
  tPos: Position,
  cellX: number,
  cellY: number
): string {
  const sN = handleNormal(sPos);
  const tN = handleNormal(tPos);
  const stub = 18;

  const sStubX = sx + sN.dx * stub;
  const sStubY = sy + sN.dy * stub;
  const tStubX = tx + tN.dx * stub;
  const tStubY = ty + tN.dy * stub;

  const octiLeg = (ax: number, ay: number, bx: number, by: number, preferChamferFirst: boolean): Point => {
    const dx = bx - ax;
    const dy = by - ay;
    const c = Math.min(Math.abs(dx), Math.abs(dy));
    if (preferChamferFirst) {
      return {
        x: ax + Math.sign(dx) * c,
        y: ay + Math.sign(dy) * c,
      };
    }
    return {
      x: bx - Math.sign(dx) * c,
      y: by - Math.sign(dy) * c,
    };
  };

  // Exit source -> chamfer -> pass straight through (cellX, cellY) -> chamfer -> enter target
  const k1 = octiLeg(sStubX, sStubY, cellX, cellY, true);
  const k2 = octiLeg(cellX, cellY, tStubX, tStubY, false);

  return buildRoundedPolyline(
    [
      { x: sx, y: sy },
      { x: sStubX, y: sStubY },
      k1,
      { x: cellX, y: cellY },
      k2,
      { x: tStubX, y: tStubY },
      { x: tx, y: ty },
    ],
    4
  );
}

export const BloxdEdge = memo(function BloxdEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { getZoom } = useReactFlow();
  const updateEdgeLabelOffset = useProjectStore((s) => s.updateEdgeLabelOffset);
  const acceptEdgeProposal = useProjectStore((s) => s.acceptEdgeProposal);
  const rejectEdgeProposal = useProjectStore((s) => s.rejectEdgeProposal);
  const snapToGrid = useProjectStore((s) => s.snapToGrid);
  const wireStyle = useProjectStore((s) => s.wireStyle);

  const edgeData = data as BloxdEdgeData | undefined;
  const curveOffset =
    typeof edgeData?.curveOffset === "number" ? edgeData.curveOffset : 0;
  const bypassOffset = edgeData?.bypassOffset;
  const savedOffset = edgeData?.labelOffset;
  const elkRoute = edgeData?.elkRoute;
  const isProposed = Boolean(edgeData?.proposed);
  const proposalNote = edgeData?.proposalNote;

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  useEffect(() => {
    setDragOffset(null);
  }, [savedOffset?.x, savedOffset?.y]);

  const [bezierDefaultPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25 + Math.abs(curveOffset) * 0.14,
  });

  const hasElkOrthoRoute =
    wireStyle === "ortho" && Boolean(elkRoute && elkRoute.points.length >= 2);

  const defaultOffsetX =
    hasElkOrthoRoute && elkRoute?.label_pos
      ? elkRoute.label_pos.x - bezierLabelX
      : bypassOffset?.x ?? 0;
  const defaultOffsetY =
    hasElkOrthoRoute && elkRoute?.label_pos
      ? elkRoute.label_pos.y - bezierLabelY
      : bypassOffset?.y ?? curveOffset * 30;

  const activeOffsetX = dragOffset?.x ?? savedOffset?.x ?? defaultOffsetX;
  const activeOffsetY = dragOffset?.y ?? savedOffset?.y ?? defaultOffsetY;

  const snapOffset = (rawX: number, rawY: number) => {
    if (!snapToGrid) return { x: rawX, y: rawY };
    const snappedCellX =
      Math.round((bezierLabelX + rawX) / GRID_SIZE) * GRID_SIZE;
    const snappedCellY =
      Math.round((bezierLabelY + rawY) / GRID_SIZE) * GRID_SIZE;
    return {
      x: snappedCellX - bezierLabelX,
      y: snappedCellY - bezierLabelY,
    };
  };

  const cellX = bezierLabelX + activeOffsetX;
  const cellY = bezierLabelY + activeOffsetY;

  let edgePath = bezierDefaultPath;
  const renderLabelX = cellX;
  const renderLabelY = cellY;

  if (wireStyle === "ortho") {
    if (hasElkOrthoRoute && elkRoute) {
      edgePath = buildRoundedPolyline(elkRoute.points, 10);
    } else {
      edgePath = buildRoundedOrthoPath(
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        cellX,
        cellY
      );
    }
  } else if (wireStyle === "circuit") {
    edgePath = buildCircuitPath(
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      cellX,
      cellY
    );
  } else if (Math.abs(activeOffsetX) > 0.5 || Math.abs(activeOffsetY) > 0.5) {
    edgePath = `M ${sourceX},${sourceY} Q ${
      2 * cellX - 0.5 * (sourceX + targetX)
    },${2 * cellY - 0.5 * (sourceY + targetY)} ${targetX},${targetY}`;
  }

  const strokeColor =
    (style?.stroke as string | undefined) ?? (selected ? "#60a5fa" : "#64748b");
  const activeStroke = selected ? "#93c5fd" : strokeColor;
  const startPt =
    hasElkOrthoRoute && elkRoute
      ? elkRoute.points[0]
      : { x: sourceX, y: sourceY };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: activeStroke,
          strokeWidth: selected ? 2.6 : 1.85,
          ...(isProposed
            ? {
                strokeDasharray: (style?.strokeDasharray as string | undefined) ?? "6 4",
                opacity: 0.78,
              }
            : {}),
          ...style,
        }}
      />
      <circle
        cx={startPt.x}
        cy={startPt.y}
        r={selected ? 3.8 : 3.1}
        fill={activeStroke}
        stroke="#020617"
        strokeWidth={1.4}
        opacity={isProposed ? 0.78 : 1}
        className="pointer-events-none"
      />
      {(label || isProposed) && (
        <EdgeLabelRenderer>
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragStartRef.current = {
                clientX: e.clientX,
                clientY: e.clientY,
                baseX: activeOffsetX,
                baseY: activeOffsetY,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragStartRef.current) return;
              e.stopPropagation();
              const zoom = getZoom() || 1;
              const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
              const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
              setDragOffset(
                snapOffset(
                  dragStartRef.current.baseX + dx,
                  dragStartRef.current.baseY + dy
                )
              );
            }}
            onPointerUp={(e) => {
              if (!dragStartRef.current) return;
              e.stopPropagation();
              const zoom = getZoom() || 1;
              const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
              const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
              const next = snapOffset(
                dragStartRef.current.baseX + dx,
                dragStartRef.current.baseY + dy
              );
              dragStartRef.current = null;
              setDragOffset(next);
              updateEdgeLabelOffset(id, next);
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                // ignore
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDragOffset(null);
              updateEdgeLabelOffset(id, null);
            }}
            title={
              isProposed
                ? proposalNote || "Proposed edge — Accept (✓) or Reject (✕)"
                : "Drag to route wire & move label · Double-click to reset"
            }
            style={{
              zIndex: 30,
              transform: `translate(-50%, -50%) translate(${renderLabelX}px,${renderLabelY}px)`,
              borderColor: isProposed ? "#38bdf8" : strokeColor,
            }}
            className={`nodrag nopan pointer-events-auto absolute flex max-w-[240px] cursor-grab items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium shadow-lg active:cursor-grabbing ${
              isProposed
                ? "border-dashed bg-slate-950/85 text-sky-200 backdrop-blur-sm"
                : "bg-slate-950 text-slate-100"
            }`}
          >
            {isProposed && (
              <span className="shrink-0 font-mono text-[9px] font-bold uppercase text-sky-400">
                PROPOSED
              </span>
            )}
            <span className="truncate">{label || proposalNote || "link"}</span>
            {isProposed && (
              <span
                className="flex shrink-0 items-center gap-0.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    acceptEdgeProposal(id);
                  }}
                  title="Accept proposed edge"
                  className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-emerald-500/20 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/40"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    rejectEdgeProposal(id);
                  }}
                  title="Reject proposed edge"
                  className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-rose-500/20 text-[10px] font-bold text-rose-300 hover:bg-rose-500/40"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
