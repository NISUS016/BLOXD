import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from "@xyflow/react";

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
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "#60a5fa" : "#64748b",
          strokeWidth: selected ? 2.5 : 1.75,
          ...style,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            className="nodrag nopan pointer-events-auto absolute rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] text-slate-300 ring-1 ring-slate-700"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
