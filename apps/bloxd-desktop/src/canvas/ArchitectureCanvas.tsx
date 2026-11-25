import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { BloxdNode as BloxdNodeModel } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";
import { BloxdEdge } from "./BloxdEdge";
import {
  BloxdFlowNodeData,
  BloxdNode,
  ExternalEdgeRef,
} from "./BloxdNode";
import { computeUnifiedContainerSizes } from "./layout";

const nodeTypes = { bloxd: BloxdNode };
const edgeTypes = { bloxd: BloxdEdge };

function topologicalSortNodes(nodes: BloxdNodeModel[]): BloxdNodeModel[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthCache = new Map<string, number>();

  const getDepth = (id: string, visiting = new Set<string>()): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = byId.get(id);
    const d =
      node?.parent_id && byId.has(node.parent_id)
        ? 1 + getDepth(node.parent_id, visiting)
        : 0;
    depthCache.set(id, d);
    return d;
  };

  return [...nodes].sort((a, b) => getDepth(a.id) - getDepth(b.id));
}

function CanvasInner({ onRequestAddNode }: { onRequestAddNode: () => void }) {
  const {
    graph,
    layout,
    currentParentId,
    viewMode,
    snapToGrid,
    setCurrentParentId,
    jumpToNode,
    setSelection,
    openInspector,
    addEdge,
    updateNodeLayout,
    updateViewport,
    ensureLayerLayout,
  } = useProjectStore();

  const { setViewport, fitView, setCenter } = useReactFlow();
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const lastRestoredLayerRef = useRef<string | null>(null);

  const layerKey =
    viewMode === "unified" ? "unified" : currentParentId ?? "root";

  const handleOpenLayer = useCallback(
    (nodeId: string) => {
      if (viewMode !== "nested") return;
      const nodeLayout = layout?.nodes[nodeId];
      if (nodeLayout) {
        const cx = nodeLayout.x + nodeLayout.width / 2;
        const cy = nodeLayout.y + nodeLayout.height / 2;
        setCenter(cx, cy, { zoom: 1.5, duration: 200 });
      }
      setTimeout(() => {
        setCurrentParentId(nodeId);
      }, 160);
    },
    [layout, setCenter, setCurrentParentId, viewMode]
  );

  // Ensure any newly opened layer with no saved layout.json positions gets Dagre auto-layout
  useEffect(() => {
    if (!graph || !layout) return;
    if (viewMode === "nested") {
      ensureLayerLayout(currentParentId);
    } else {
      const parentKeys = new Set<string | null>([null]);
      for (const n of graph.nodes) {
        parentKeys.add(n.parent_id ?? null);
      }
      for (const key of parentKeys) {
        ensureLayerLayout(key);
      }
    }
  }, [graph, layout, currentParentId, viewMode, ensureLayerLayout]);

  // Child counts per node for progress badges
  const childStats = useMemo(() => {
    const stats = new Map<string, { total: number; done: number }>();
    if (!graph) return stats;
    for (const n of graph.nodes) {
      if (n.parent_id) {
        const entry = stats.get(n.parent_id) ?? { total: 0, done: 0 };
        entry.total += 1;
        if (n.status === "done") entry.done += 1;
        stats.set(n.parent_id, entry);
      }
    }
    return stats;
  }, [graph]);

  // Build React Flow nodes whenever graph, layout, viewMode, or currentParentId changes
  useEffect(() => {
    if (!graph || !layout) {
      setRfNodes([]);
      return;
    }

    if (viewMode === "nested") {
      const visible = graph.nodes.filter(
        (n) => (n.parent_id ?? null) === currentParentId
      );
      const visibleIds = new Set(visible.map((n) => n.id));
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));

      const nextNodes: Node[] = visible.map((n, index) => {
        const saved = layout.nodes[n.id];
        const stats = childStats.get(n.id) ?? { total: 0, done: 0 };

        const externalIn: ExternalEdgeRef[] = [];
        const externalOut: ExternalEdgeRef[] = [];

        for (const e of graph.edges) {
          if (e.target === n.id && !visibleIds.has(e.source)) {
            const src = byId.get(e.source);
            if (src) {
              externalIn.push({
                edgeId: e.id,
                nodeId: src.id,
                title: src.title,
                label: e.label,
                parentId: src.parent_id,
              });
            }
          } else if (e.source === n.id && !visibleIds.has(e.target)) {
            const dst = byId.get(e.target);
            if (dst) {
              externalOut.push({
                edgeId: e.id,
                nodeId: dst.id,
                title: dst.title,
                label: e.label,
                parentId: dst.parent_id,
              });
            }
          }
        }

        return {
          id: n.id,
          type: "bloxd",
          position: saved
            ? { x: saved.x, y: saved.y }
            : { x: 80 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 150 },
          style: {
            width: Math.max(saved?.width ?? 260, 260),
            height: Math.max(saved?.height ?? 136, 136),
          },
          data: {
            model: n,
            childCount: stats.total,
            doneCount: stats.done,
            externalIn,
            externalOut,
            onOpenLayer: handleOpenLayer,
            onJumpToNode: jumpToNode,
          } satisfies BloxdFlowNodeData,
        };
      });
      setRfNodes(nextNodes);
    } else {
      const ordered = topologicalSortNodes(graph.nodes);
      const hasChildren = new Set(
        graph.nodes.map((n) => n.parent_id).filter(Boolean) as string[]
      );
      const containerSizes = computeUnifiedContainerSizes(
        graph.nodes,
        layout.nodes
      );

      const nextNodes: Node[] = ordered.map((n, index) => {
        const saved = layout.nodes[n.id];
        const stats = childStats.get(n.id) ?? { total: 0, done: 0 };
        const isContainer = hasChildren.has(n.id);
        const size = containerSizes[n.id] ?? {
          width: saved?.width ?? 240,
          height: saved?.height ?? 110,
        };

        return {
          id: n.id,
          type: "bloxd",
          parentId: n.parent_id ?? undefined,
          extent: n.parent_id ? "parent" : undefined,
          position: saved
            ? { x: saved.x, y: saved.y }
            : { x: 60 + (index % 3) * 280, y: 70 + Math.floor(index / 3) * 160 },
          style: {
            width: size.width,
            height: size.height,
          },
          data: {
            model: n,
            childCount: stats.total,
            doneCount: stats.done,
            isGroupContainer: isContainer,
          } satisfies BloxdFlowNodeData,
        };
      });
      setRfNodes(nextNodes);
    }
  }, [graph, layout, currentParentId, viewMode, childStats, handleOpenLayer, jumpToNode]);

  // Restore saved viewport when switching layers or projects
  useEffect(() => {
    if (!graph || !layout) return;
    if (lastRestoredLayerRef.current === `${graph.project}:${layerKey}`) return;
    lastRestoredLayerRef.current = `${graph.project}:${layerKey}`;

    const savedVp = layout.viewports[layerKey];
    requestAnimationFrame(() => {
      if (savedVp) {
        setViewport(savedVp, { duration: 220 });
      } else {
        fitView({ padding: 0.25, duration: 220 });
      }
    });
  }, [graph, layout, layerKey, setViewport, fitView]);

  // Auto-arrange Unified view once when switching into Unified mode if root containers overlap
  const lastUnifiedLayoutProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!graph || !layout || viewMode !== "unified") return;
    const key = `${graph.project}:${graph.nodes.length}`;
    if (lastUnifiedLayoutProjectRef.current === key) return;
    lastUnifiedLayoutProjectRef.current = key;

    // Check if any root-level nodes overlap after container expansion
    const containerSizes = computeUnifiedContainerSizes(graph.nodes, layout.nodes);
    const roots = graph.nodes.filter((n) => (n.parent_id ?? null) === null);
    let hasOverlap = false;
    for (let i = 0; i < roots.length && !hasOverlap; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        const aPos = layout.nodes[roots[i].id];
        const bPos = layout.nodes[roots[j].id];
        if (!aPos || !bPos) continue;
        const aSize = containerSizes[roots[i].id] ?? aPos;
        const bSize = containerSizes[roots[j].id] ?? bPos;
        const overlapX = aPos.x < bPos.x + bSize.width && aPos.x + aSize.width > bPos.x;
        const overlapY = aPos.y < bPos.y + bSize.height && aPos.y + aSize.height > bPos.y;
        if (overlapX && overlapY) {
          hasOverlap = true;
          break;
        }
      }
    }
    if (hasOverlap) {
      useProjectStore.getState().autoLayoutCurrentLayer();
    }
  }, [graph, layout, viewMode]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const visibleIds = new Set(rfNodes.map((n) => n.id));
    const rfNodeMap = new Map(rfNodes.map((n) => [n.id, n]));
    const absPosCache = new Map<string, { x: number; y: number }>();
    const getAbsPos = (id: string, seen = new Set<string>()): { x: number; y: number } => {
      if (absPosCache.has(id)) return absPosCache.get(id)!;
      const n = rfNodeMap.get(id);
      if (!n || seen.has(id)) return { x: 0, y: 0 };
      seen.add(id);
      const parentAbs = n.parentId ? getAbsPos(n.parentId, seen) : { x: 0, y: 0 };
      const abs = { x: parentAbs.x + n.position.x, y: parentAbs.y + n.position.y };
      absPosCache.set(id, abs);
      return abs;
    };

    const nodeRects = new Map<
      string,
      { cx: number; cy: number }
    >();
    for (const n of rfNodes) {
      const w = (n.style?.width as number | undefined) ?? 260;
      const h = (n.style?.height as number | undefined) ?? 136;
      const abs = getAbsPos(n.id);
      nodeRects.set(n.id, {
        cx: abs.x + w / 2,
        cy: abs.y + h / 2,
      });
    }

    const inProgressIds = new Set(
      graph.nodes.filter((n) => n.status === "in_progress").map((n) => n.id)
    );

    const KIND_EDGE_COLORS: Record<string, string> = {
      data_flow: "#22d3ee",
      triggers: "#a78bfa",
      sequence: "#34d399",
      dependency: "#60a5fa",
    };

    const ROLLUP_PALETTE = [
      "#38bdf8",
      "#c084fc",
      "#34d399",
      "#fb7185",
      "#fbbf24",
      "#818cf8",
    ];

    const pickHandles = (
      sourceId: string,
      targetId: string,
      hasReverse: boolean,
      isReverseSecond: boolean
    ): { sourceHandle: string; targetHandle: string; curveOffset: number } => {
      const s = nodeRects.get(sourceId);
      const t = nodeRects.get(targetId);
      if (!s || !t) {
        return { sourceHandle: "right", targetHandle: "left", curveOffset: 0 };
      }
      const dx = t.cx - s.cx;
      const dy = t.cy - s.cy;

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx >= 0) {
          return hasReverse
            ? isReverseSecond
              ? { sourceHandle: "bottom", targetHandle: "bottom", curveOffset: 1 }
              : { sourceHandle: "right", targetHandle: "left", curveOffset: -1 }
            : { sourceHandle: "right", targetHandle: "left", curveOffset: 0 };
        }
        return hasReverse
          ? isReverseSecond
            ? { sourceHandle: "top", targetHandle: "top", curveOffset: 1 }
            : { sourceHandle: "left", targetHandle: "right", curveOffset: -1 }
          : { sourceHandle: "left", targetHandle: "right", curveOffset: 0 };
      }

      if (dy >= 0) {
        return hasReverse
          ? isReverseSecond
            ? { sourceHandle: "right", targetHandle: "right", curveOffset: 1 }
            : { sourceHandle: "bottom", targetHandle: "top", curveOffset: -1 }
          : { sourceHandle: "bottom", targetHandle: "top", curveOffset: 0 };
      }
      return hasReverse
        ? isReverseSecond
          ? { sourceHandle: "left", targetHandle: "left", curveOffset: 1 }
          : { sourceHandle: "top", targetHandle: "bottom", curveOffset: -1 }
        : { sourceHandle: "top", targetHandle: "bottom", curveOffset: 0 };
    };

    const rawDirect = graph.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    );
    const directPairSet = new Set(rawDirect.map((e) => `${e.source}->${e.target}`));

    const directEdges: Edge[] = rawDirect.map((e) => {
      const isActive =
        inProgressIds.has(e.source) || inProgressIds.has(e.target);
      const hasReverse = directPairSet.has(`${e.target}->${e.source}`);
      const isReverseSecond = hasReverse && e.source > e.target;
      const { sourceHandle, targetHandle, curveOffset } = pickHandles(
        e.source,
        e.target,
        hasReverse,
        isReverseSecond
      );
      const color = isActive
        ? "#f59e0b"
        : KIND_EDGE_COLORS[e.kind] ?? "#60a5fa";

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        type: "bloxd",
        label: e.label ?? undefined,
        animated: isActive,
        data: {
          curveOffset,
          labelOffset: layout?.edge_labels?.[e.id],
        },
        style: { stroke: color, strokeWidth: isActive ? 2.2 : 1.85 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
      };
    });

    if (viewMode !== "nested") {
      return directEdges;
    }

    // In Nested mode, roll up cross-layer edges between descendants onto their visible ancestors
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const findVisibleAncestor = (id: string): string | null => {
      let cur: string | undefined | null = id;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (visibleIds.has(cur)) return cur;
        seen.add(cur);
        cur = byId.get(cur)?.parent_id;
      }
      return null;
    };

    const rolledUp = new Map<
      string,
      { source: string; target: string; labels: string[]; kinds: string[] }
    >();

    for (const e of graph.edges) {
      const srcVis = findVisibleAncestor(e.source);
      const dstVis = findVisibleAncestor(e.target);
      if (!srcVis || !dstVis || srcVis === dstVis) continue;
      const pairKey = `${srcVis}->${dstVis}`;
      if (directPairSet.has(pairKey)) continue;

      const entry = rolledUp.get(pairKey) ?? {
        source: srcVis,
        target: dstVis,
        labels: [],
        kinds: [],
      };
      if (e.label) entry.labels.push(e.label);
      entry.kinds.push(e.kind);
      rolledUp.set(pairKey, entry);
    }

    const rolledEdges: Edge[] = [...rolledUp.entries()].map(
      ([pairKey, info], idx) => {
        const reverseKey = `${info.target}->${info.source}`;
        const hasReverse = rolledUp.has(reverseKey) || directPairSet.has(reverseKey);
        const isReverseSecond = hasReverse && info.source > info.target;
        const { sourceHandle, targetHandle, curveOffset } = pickHandles(
          info.source,
          info.target,
          hasReverse,
          isReverseSecond
        );
        const color = ROLLUP_PALETTE[idx % ROLLUP_PALETTE.length];

        return {
          id: `rollup-${pairKey}`,
          source: info.source,
          target: info.target,
          sourceHandle,
          targetHandle,
          type: "bloxd",
          label:
            info.labels.length === 1
              ? info.labels[0]
              : `${info.labels.length || 1} links`,
          data: {
            curveOffset,
            labelOffset: layout?.edge_labels?.[`rollup-${pairKey}`],
          },
          style: {
            stroke: color,
            strokeWidth: 1.75,
            strokeDasharray: "5 4",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
          },
        };
      }
    );

    return [...directEdges, ...rolledEdges];
  }, [graph, rfNodes, viewMode]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      updateNodeLayout(node.id, {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
    },
    [updateNodeLayout]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdge({
        source: connection.source,
        target: connection.target,
      });
    },
    [addEdge]
  );

  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      updateViewport(layerKey, viewport);
    },
    [layerKey, updateViewport]
  );

  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      setSelection(nodes[0]?.id ?? null, edges[0]?.id ?? null);
    },
    [setSelection]
  );

  if (!graph) return null;

  return (
    <div className="relative h-full w-full flex-1 bg-slate-950">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_, node) => openInspector(node.id)}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        onSelectionChange={onSelectionChange}
        connectionMode={ConnectionMode.Loose}
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        deleteKeyCode={["Delete"]}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#334155"
        />
        <Controls className="!border-slate-800 !bg-slate-900 !text-slate-200" />
        <MiniMap
          pannable
          zoomable
          nodeColor="#3b82f6"
          maskColor="rgba(2, 6, 23, 0.7)"
          className="!border !border-slate-800 !bg-slate-900"
        />
      </ReactFlow>

      {rfNodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto rounded-xl border border-dashed border-slate-700 bg-slate-900/80 px-6 py-5 text-center backdrop-blur-sm">
            <p className="text-sm font-medium text-slate-200">
              {currentParentId
                ? `Layer "${currentParentId}" has no child nodes yet`
                : "This layer has no nodes yet"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Add a node to start mapping your architecture.
            </p>
            <button
              type="button"
              onClick={onRequestAddNode}
              className="mt-3 cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              + Add Node
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ArchitectureCanvas({
  onRequestAddNode,
}: {
  onRequestAddNode: () => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner onRequestAddNode={onRequestAddNode} />
    </ReactFlowProvider>
  );
}
