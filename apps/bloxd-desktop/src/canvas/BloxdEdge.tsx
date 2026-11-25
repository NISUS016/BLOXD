import { memo, useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { useProjectStore } from "../store/useProjectStore";

interface BloxdEdgeData {
  curveOffset?: number;
  labelOffset?: { x: number; y: number };
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

  const edgeData = data as BloxdEdgeData | undefined;
  const curveOffset =
    typeof edgeData?.curveOffset === "number" ? edgeData.curveOffset : 0;
  const savedOffset = edgeData?.labelOffset;

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

  const [defaultPath, defaultLabelX, defaultLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25 + Math.abs(curveOffset) * 0.15,
  });

  const activeOffsetX = dragOffset?.x ?? savedOffset?.x ?? 0;
  const activeOffsetY =
    dragOffset?.y ?? savedOffset?.y ?? curveOffset * 24;

  const hasCustomCurve = activeOffsetX !== 0 || activeOffsetY !== 0;

  // Position of the label cell in flow coordinates
  const cellX = defaultLabelX + activeOffsetX;
  const cellY = defaultLabelY + activeOffsetY;

  // Quadratic Bezier passing through (cellX, cellY) at t = 0.5:
  // P(0.5) = 0.25*S + 0.5*C + 0.25*T  =>  C = 2*P(0.5) - 0.5*(S + T)
  const edgePath = hasCustomCurve
    ? `M ${sourceX},${sourceY} Q ${2 * cellX - 0.5 * (sourceX + targetX)},${
        2 * cellY - 0.5 * (sourceY + targetY)
      } ${targetX},${targetY}`
    : defaultPath;

  const strokeColor =
    (style?.stroke as string | undefined) ?? (selected ? "#60a5fa" : "#64748b");

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "#93c5fd" : strokeColor,
          strokeWidth: selected ? 2.6 : 1.85,
          ...style,
        }}
      />
      {label && (
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
              setDragOffset({
                x: dragStartRef.current.baseX + dx,
                y: dragStartRef.current.baseY + dy,
              });
            }}
            onPointerUp={(e) => {
              if (!dragStartRef.current) return;
              e.stopPropagation();
              const zoom = getZoom() || 1;
              const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
              const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
              const next = {
                x: dragStartRef.current.baseX + dx,
                y: dragStartRef.current.baseY + dy,
              };
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
              const reset = { x: 0, y: curveOffset * 24 };
              setDragOffset(reset);
              updateEdgeLabelOffset(id, reset);
            }}
            title="Drag to bend wire & move label · Double-click to reset"
            style={{
              zIndex: 30,
              transform: `translate(-50%, -50%) translate(${cellX}px,${cellY}px)`,
              borderColor: strokeColor,
            }}
            className="nodrag nopan pointer-events-auto absolute max-w-[200px] cursor-grab truncate rounded border bg-slate-950 px-2 py-0.5 text-[10px] font-medium text-slate-100 shadow-lg active:cursor-grabbing"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
