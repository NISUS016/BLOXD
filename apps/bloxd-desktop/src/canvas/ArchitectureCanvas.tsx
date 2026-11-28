import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  ControlButton,
  Controls,
  Edge,
  getBezierPath,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { BloxdNode as BloxdNodeModel } from "../bindings";
import { useProjectStore, WireStyle } from "../store/useProjectStore";
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
    checklists,
    drift,
    selectedNodeIds,
    currentParentId,
    viewMode,
    wireStyle,
    snapToGrid,
    setCurrentParentId,
    setWireStyle,
    toggleSnapToGrid,
    jumpToNode,
    setSelection,
    openInspector,
    copySelectedContext,
    addEdge,
    updateNodeLayout,
    updateViewport,
    ensureLayerLayout,
  } = useProjectStore();

  const { setViewport, fitView, setCenter } = useReactFlow();
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
            width: saved?.width ?? 260,
            height: saved?.height ?? 136,
          },
          data: {
            model: n,
            childCount: stats.total,
            doneCount: stats.done,
            checklist: checklists[n.id],
            driftCount: drift?.drifted?.[n.id]?.length ?? 0,
            externalIn,
            externalOut,
            onOpenLayer: handleOpenLayer,
            onJumpToNode: jumpToNode,
            onResizeNode: (id, rect) => updateNodeLayout(id, rect),
          } satisfies BloxdFlowNodeData,
        };
      });
      setRfNodes(nextNodes);
    } else {
      const ordered = topologicalSortNodes(graph.nodes);
      const hasChildren = new Set(
        graph.nodes.map((n) => n.parent_id).filter(Boolean) as string[]
      );
      const effectiveUnifiedNodes: Record<string, typeof layout.nodes[string]> = {
        ...layout.nodes,
        ...(layout.unified_nodes ?? {}),
      };
      const containerSizes = computeUnifiedContainerSizes(
        graph.nodes,
        effectiveUnifiedNodes
      );

      const nextNodes: Node[] = ordered.map((n, index) => {
        const saved = effectiveUnifiedNodes[n.id];
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
            checklist: checklists[n.id],
            driftCount: drift?.drifted?.[n.id]?.length ?? 0,
            isGroupContainer: isContainer,
            onResizeNode: (id, rect) => updateNodeLayout(id, rect),
          } satisfies BloxdFlowNodeData,
        };
      });
      setRfNodes(nextNodes);
    }
  }, [graph, layout, checklists, drift, currentParentId, viewMode, childStats, handleOpenLayer, jumpToNode, updateNodeLayout]);

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

  // In Unified mode, only run ELK auto-layout once when unified_nodes is missing or incomplete
  const lastUnifiedLayoutProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!graph || !layout || viewMode !== "unified") return;
    const unifiedNodes = layout.unified_nodes ?? {};
    const hasAllNodes = graph.nodes.every((n) => Boolean(unifiedNodes[n.id]));
    if (hasAllNodes) return;

    const key = `${graph.project}:${graph.nodes.length}`;
    if (lastUnifiedLayoutProjectRef.current === key) return;
    lastUnifiedLayoutProjectRef.current = key;
    useProjectStore.getState().autoLayoutCurrentLayer();
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

    interface Rect {
      x: number;
      y: number;
      w: number;
      h: number;
    }

    const nodeRects = new Map<
      string,
      { cx: number; cy: number; x: number; y: number; width: number; height: number; isContainer: boolean }
    >();
    for (const n of rfNodes) {
      const w = (n.style?.width as number | undefined) ?? 260;
      const h = (n.style?.height as number | undefined) ?? 136;
      const abs = getAbsPos(n.id);
      const isContainer = Boolean((n.data as { isGroupContainer?: boolean } | undefined)?.isGroupContainer);
      nodeRects.set(n.id, {
        cx: abs.x + w / 2,
        cy: abs.y + h / 2,
        x: abs.x,
        y: abs.y,
        width: w,
        height: h,
        isContainer,
      });
    }

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const isDescendantOf = (nodeId: string, ancestorId: string): boolean => {
      let cur = nodeById.get(nodeId)?.parent_id;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === ancestorId) return true;
        seen.add(cur);
        cur = nodeById.get(cur)?.parent_id;
      }
      return false;
    };

    const handleCoords = (
      nodeId: string,
      handle: string
    ): { x: number; y: number; pos: Position } => {
      const r = nodeRects.get(nodeId);
      if (!r) return { x: 0, y: 0, pos: Position.Right };
      switch (handle) {
        case "top":
          return { x: r.cx, y: r.y, pos: Position.Top };
        case "bottom":
          return { x: r.cx, y: r.y + r.height, pos: Position.Bottom };
        case "left":
          return { x: r.x, y: r.cy, pos: Position.Left };
        default:
          return { x: r.x + r.width, y: r.cy, pos: Position.Right };
      }
    };

    const overlapArea = (a: Rect, b: Rect, pad = 0): number => {
      const ox = Math.max(0, Math.min(a.x + a.w + pad, b.x + b.w) - Math.max(a.x - pad, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h + pad, b.y + b.h) - Math.max(a.y - pad, b.y));
      return ox * oy;
    };

    const segIntersectsRect = (ax: number, ay: number, bx: number, by: number, r: Rect): boolean => {
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      if (maxX < r.x || minX > r.x + r.w || maxY < r.y || minY > r.y + r.h) return false;
      const steps = 10;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          return true;
        }
      }
      return false;
    };

    // Smart handle selection: chooses top/bottom for bidirectional return edges by testing open whitespace
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

      // Count how many unrelated cards occupy a probe band around [s, t]
      const bandScore = (band: Rect): number => {
        let hits = 0;
        for (const [obsId, box] of nodeRects.entries()) {
          if (obsId === sourceId || obsId === targetId) continue;
          const r = box.isContainer
            ? isDescendantOf(sourceId, obsId) || isDescendantOf(targetId, obsId)
              ? { x: box.x, y: box.y, w: box.width, h: 108 }
              : { x: box.x, y: box.y, w: box.width, h: box.height }
            : { x: box.x, y: box.y, w: box.width, h: box.height };
          hits += overlapArea(band, r, 0);
        }
        return hits;
      };

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (!hasReverse) {
          return dx >= 0
            ? { sourceHandle: "right", targetHandle: "left", curveOffset: 0 }
            : { sourceHandle: "left", targetHandle: "right", curveOffset: 0 };
        }
        if (!isReverseSecond) {
          return dx >= 0
            ? { sourceHandle: "right", targetHandle: "left", curveOffset: 0 }
            : { sourceHandle: "left", targetHandle: "right", curveOffset: 0 };
        }
        const spanX = Math.min(s.x, t.x);
        const spanW = Math.max(s.x + s.width, t.x + t.width) - spanX;
        const topHits = bandScore({ x: spanX, y: Math.min(s.y, t.y) - 90, w: spanW, h: 80 });
        const botHits = bandScore({ x: spanX, y: Math.max(s.y + s.height, t.y + t.height) + 10, w: spanW, h: 80 });
        return topHits <= botHits
          ? { sourceHandle: "top", targetHandle: "top", curveOffset: -1 }
          : { sourceHandle: "bottom", targetHandle: "bottom", curveOffset: 1 };
      }

      if (!hasReverse) {
        return dy >= 0
          ? { sourceHandle: "bottom", targetHandle: "top", curveOffset: 0 }
          : { sourceHandle: "top", targetHandle: "bottom", curveOffset: 0 };
      }
      if (!isReverseSecond) {
        return dy >= 0
          ? { sourceHandle: "bottom", targetHandle: "top", curveOffset: 0 }
          : { sourceHandle: "top", targetHandle: "bottom", curveOffset: 0 };
      }
      const spanY = Math.min(s.y, t.y);
      const spanH = Math.max(s.y + s.height, t.y + t.height) - spanY;
      const rightHits = bandScore({ x: Math.max(s.x + s.width, t.x + t.width) + 10, y: spanY, w: 180, h: spanH });
      const leftHits = bandScore({ x: Math.min(s.x, t.x) - 190, y: spanY, w: 180, h: spanH });
      return rightHits <= leftHits
        ? { sourceHandle: "right", targetHandle: "right", curveOffset: 1 }
        : { sourceHandle: "left", targetHandle: "left", curveOffset: -1 };
    };

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

    interface PendingEdgeSpec {
      id: string;
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
      staggeredOffset: number;
      label?: string;
      animated?: boolean;
      color: string;
      strokeWidth: number;
      strokeDasharray?: string;
    }

    const activeEdgeLabels =
      viewMode === "unified" ? layout?.unified_edge_labels : layout?.edge_labels;
    const activeEdgeRoutes =
      viewMode === "unified" ? layout?.unified_edge_routes : layout?.edge_routes;

    const pendingSpecs: PendingEdgeSpec[] = [];
    const rawDirect = graph.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    );
    const directPairSet = new Set(rawDirect.map((e) => `${e.source}->${e.target}`));
    const corridorCounts = new Map<string, number>();

    for (const e of rawDirect) {
      const isActive =
        inProgressIds.has(e.source) || inProgressIds.has(e.target);
      const hasReverse = directPairSet.has(`${e.target}->${e.source}`);
      const isReverseSecond = hasReverse && e.source > e.target;
      const storedRoute = activeEdgeRoutes?.[e.id];
      const { sourceHandle, targetHandle, curveOffset } = storedRoute
        ? {
            sourceHandle: storedRoute.source_side,
            targetHandle: storedRoute.target_side,
            curveOffset: 0,
          }
        : pickHandles(e.source, e.target, hasReverse, isReverseSecond);
      const corridorKey = `${[e.source, e.target].sort().join("|")}:${sourceHandle}:${targetHandle}`;
      const seenCount = corridorCounts.get(corridorKey) ?? 0;
      corridorCounts.set(corridorKey, seenCount + 1);
      const staggeredOffset = storedRoute
        ? 0
        : curveOffset +
          (seenCount === 0
            ? 0
            : (seenCount % 2 === 1 ? 1 : -1) * Math.ceil(seenCount / 2) * 1.1);
      const color = isActive
        ? "#f59e0b"
        : KIND_EDGE_COLORS[e.kind] ?? "#60a5fa";

      pendingSpecs.push({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        staggeredOffset,
        label: e.label ?? undefined,
        animated: isActive,
        color,
        strokeWidth: isActive ? 2.2 : 1.85,
      });
    }

    if (viewMode === "nested") {
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

      let idx = 0;
      for (const [pairKey, info] of rolledUp.entries()) {
        const routeId = `rollup-${pairKey}`;
        const reverseKey = `${info.target}->${info.source}`;
        const hasReverse = rolledUp.has(reverseKey) || directPairSet.has(reverseKey);
        const isReverseSecond = hasReverse && info.source > info.target;
        const storedRoute = activeEdgeRoutes?.[routeId];
        const { sourceHandle, targetHandle, curveOffset } = storedRoute
          ? {
              sourceHandle: storedRoute.source_side,
              targetHandle: storedRoute.target_side,
              curveOffset: 0,
            }
          : pickHandles(info.source, info.target, hasReverse, isReverseSecond);
        const color = ROLLUP_PALETTE[idx % ROLLUP_PALETTE.length];
        idx++;

        pendingSpecs.push({
          id: routeId,
          source: info.source,
          target: info.target,
          sourceHandle,
          targetHandle,
          staggeredOffset: curveOffset,
          label:
            info.labels.length === 1
              ? info.labels[0]
              : `${info.labels.length || 1} links`,
          color,
          strokeWidth: 1.75,
          strokeDasharray: "5 4",
        });
      }
    }

    // Dynamic Multi-Obstacle + Label-Pill Collision Solver across ALL edges without a stored ELK route
    const placedLabelRects: Rect[] = [];
    const solvedByEdgeId = new Map<string, { x: number; y: number }>();

    // First reserve labels for edges that already have stored ELK routes or manual label offsets
    const fallbackSpecs: PendingEdgeSpec[] = [];
    for (const spec of pendingSpecs) {
      const storedRoute = activeEdgeRoutes?.[spec.id];
      const saved = activeEdgeLabels?.[spec.id];
      const pillW = spec.label
        ? Math.min(206, Math.round(Math.min(34, spec.label.length) * 6.3 + 22))
        : 24;
      const pillH = spec.label ? 26 : 16;

      if (saved) {
        const sPt = handleCoords(spec.source, spec.sourceHandle);
        const tPt = handleCoords(spec.target, spec.targetHandle);
        const [, bezX, bezY] = getBezierPath({
          sourceX: sPt.x,
          sourceY: sPt.y,
          sourcePosition: sPt.pos,
          targetX: tPt.x,
          targetY: tPt.y,
          targetPosition: tPt.pos,
          curvature: 0.25 + Math.abs(spec.staggeredOffset) * 0.14,
        });
        const cx = bezX + saved.x;
        const cy = bezY + saved.y;
        if (spec.label) {
          placedLabelRects.push({ x: cx - pillW / 2, y: cy - pillH / 2, w: pillW, h: pillH });
        }
        solvedByEdgeId.set(spec.id, saved);
        continue;
      }

      if (storedRoute) {
        if (spec.label && storedRoute.label_pos) {
          placedLabelRects.push({
            x: storedRoute.label_pos.x - pillW / 2,
            y: storedRoute.label_pos.y - pillH / 2,
            w: pillW,
            h: pillH,
          });
        }
        continue;
      }

      fallbackSpecs.push(spec);
    }

    // Sort invalidated/dynamic edges shortest-first so tight pairs claim direct corridors first
    const sortedSpecs = [...fallbackSpecs].sort((a, b) => {
      const sa = nodeRects.get(a.source);
      const ta = nodeRects.get(a.target);
      const sb = nodeRects.get(b.source);
      const tb = nodeRects.get(b.target);
      const da = sa && ta ? Math.hypot(ta.cx - sa.cx, ta.cy - sa.cy) : 0;
      const db = sb && tb ? Math.hypot(tb.cx - sb.cx, tb.cy - sb.cy) : 0;
      return da - db;
    });

    for (const spec of sortedSpecs) {
      const sPt = handleCoords(spec.source, spec.sourceHandle);
      const tPt = handleCoords(spec.target, spec.targetHandle);
      const [, bezX, bezY] = getBezierPath({
        sourceX: sPt.x,
        sourceY: sPt.y,
        sourcePosition: sPt.pos,
        targetX: tPt.x,
        targetY: tPt.y,
        targetPosition: tPt.pos,
        curvature: 0.25 + Math.abs(spec.staggeredOffset) * 0.14,
      });

      const pillW = spec.label
        ? Math.min(206, Math.round(Math.min(34, spec.label.length) * 6.3 + 22))
        : 24;
      const pillH = spec.label ? 26 : 16;

      // Compute natural anchor (same-side edges always bow OUTWARD, never inward into cards)
      let anchorX = bezX;
      let anchorY = bezY;
      if (spec.sourceHandle === spec.targetHandle) {
        if (spec.sourceHandle === "top") {
          const sBox = nodeRects.get(spec.source);
          const tBox = nodeRects.get(spec.target);
          anchorX = (sPt.x + tPt.x) * 0.5;
          anchorY = Math.min(sBox?.y ?? sPt.y, tBox?.y ?? tPt.y) - 46;
        } else if (spec.sourceHandle === "bottom") {
          const sBox = nodeRects.get(spec.source);
          const tBox = nodeRects.get(spec.target);
          anchorX = (sPt.x + tPt.x) * 0.5;
          anchorY =
            Math.max(
              (sBox?.y ?? sPt.y) + (sBox?.height ?? 0),
              (tBox?.y ?? tPt.y) + (tBox?.height ?? 0)
            ) + 46;
        } else if (spec.sourceHandle === "left") {
          const sBox = nodeRects.get(spec.source);
          const tBox = nodeRects.get(spec.target);
          anchorX = Math.min(sBox?.x ?? sPt.x, tBox?.x ?? tPt.x) - Math.max(96, pillW / 2 + 24);
          anchorY = (sPt.y + tPt.y) * 0.5;
        } else {
          const sBox = nodeRects.get(spec.source);
          const tBox = nodeRects.get(spec.target);
          anchorX =
            Math.max(
              (sBox?.x ?? sPt.x) + (sBox?.width ?? 0),
              (tBox?.x ?? tPt.x) + (tBox?.width ?? 0)
            ) + Math.max(96, pillW / 2 + 24);
          anchorY = (sPt.y + tPt.y) * 0.5;
        }
      } else if (spec.staggeredOffset !== 0) {
        const dx = tPt.x - sPt.x;
        const dy = tPt.y - sPt.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        anchorX += nx * spec.staggeredOffset * 38;
        anchorY += ny * spec.staggeredOffset * 38;
      }

      // Build obstacle list tailored to this edge
      const pillObstacles: { rect: Rect; isEndpoint: boolean }[] = [];
      const wireObstacles: Rect[] = [];

      for (const [obsId, box] of nodeRects.entries()) {
        const isEnd = obsId === spec.source || obsId === spec.target;
        if (box.isContainer) {
          const srcIn = isDescendantOf(spec.source, obsId);
          const dstIn = isDescendantOf(spec.target, obsId);
          // Container top header band is ALWAYS forbidden for label pills
          pillObstacles.push({
            rect: { x: box.x, y: box.y, w: box.width, h: 108 },
            isEndpoint: isEnd,
          });
          if (!isEnd && !srcIn && !dstIn) {
            const full = { x: box.x, y: box.y, w: box.width, h: box.height };
            pillObstacles.push({ rect: full, isEndpoint: false });
            wireObstacles.push(full);
          } else if (!isEnd) {
            wireObstacles.push({ x: box.x, y: box.y, w: box.width, h: 104 });
          }
        } else {
          const full = { x: box.x, y: box.y, w: box.width, h: box.height };
          pillObstacles.push({ rect: full, isEndpoint: isEnd });
          if (!isEnd) wireObstacles.push(full);
        }
      }

      const candidates: { x: number; y: number }[] = [{ x: anchorX, y: anchorY }];
      // Slide along the chord t in [0.25 .. 0.75]
      for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
        const lx = sPt.x + (tPt.x - sPt.x) * t;
        const ly = sPt.y + (tPt.y - sPt.y) * t;
        candidates.push({ x: lx, y: ly });
        for (const dy of [-36, 36, -72, 72, -110, 110, -150, 150]) {
          candidates.push({ x: lx, y: ly + dy });
        }
        for (const dx of [-44, 44, -90, 90, -140, 140]) {
          candidates.push({ x: lx + dx, y: ly });
        }
      }
      // Escape just outside any obstacle blocking the anchor
      const anchorRect: Rect = {
        x: anchorX - pillW / 2,
        y: anchorY - pillH / 2,
        w: pillW,
        h: pillH,
      };
      for (const { rect: obs } of pillObstacles) {
        if (overlapArea(anchorRect, obs, 24) > 0) {
          const marginY = pillH / 2 + 18;
          const marginX = pillW / 2 + 20;
          candidates.push(
            { x: anchorX, y: obs.y - marginY },
            { x: anchorX, y: obs.y + obs.h + marginY },
            { x: obs.x - marginX, y: anchorY },
            { x: obs.x + obs.w + marginX, y: anchorY },
            { x: obs.x - marginX, y: obs.y - marginY },
            { x: obs.x + obs.w + marginX, y: obs.y - marginY }
          );
        }
      }
      // Ring offsets around already-placed label pills
      for (const pr of placedLabelRects) {
        if (overlapArea(anchorRect, pr, 20) > 0) {
          candidates.push(
            { x: anchorX, y: pr.y - pillH - 8 },
            { x: anchorX, y: pr.y + pr.h + pillH + 8 },
            { x: pr.x - pillW / 2 - 14, y: anchorY },
            { x: pr.x + pr.w + pillW / 2 + 14, y: anchorY }
          );
        }
      }

      let bestX = anchorX;
      let bestY = anchorY;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const cand of candidates) {
        const pr: Rect = {
          x: cand.x - pillW / 2,
          y: cand.y - pillH / 2,
          w: pillW,
          h: pillH,
        };
        let cost = Math.hypot(cand.x - anchorX, cand.y - anchorY) * 0.4;

        for (const { rect: obs, isEndpoint } of pillObstacles) {
          const area = overlapArea(pr, obs, isEndpoint ? 6 : 12);
          if (area > 0) {
            cost += 120_000 + area * 10;
          }
        }

        for (const placed of placedLabelRects) {
          const area = overlapArea(pr, placed, 10);
          if (area > 0) {
            cost += 60_000 + area * 8;
          }
        }

        // Penalize wire segments cutting through unrelated intermediate cards
        for (const obs of wireObstacles) {
          if (segIntersectsRect(sPt.x, sPt.y, cand.x, cand.y, obs)) cost += 1_500;
          if (segIntersectsRect(cand.x, cand.y, tPt.x, tPt.y, obs)) cost += 1_500;
        }

        if (cost < bestCost) {
          bestCost = cost;
          bestX = cand.x;
          bestY = cand.y;
        }
      }

      if (spec.label) {
        placedLabelRects.push({
          x: bestX - pillW / 2,
          y: bestY - pillH / 2,
          w: pillW,
          h: pillH,
        });
      }

      solvedByEdgeId.set(spec.id, {
        x: Math.round(bestX - bezX),
        y: Math.round(bestY - bezY),
      });
    }

    return pendingSpecs.map((spec) => ({
      id: spec.id,
      source: spec.source,
      target: spec.target,
      sourceHandle: spec.sourceHandle,
      targetHandle: spec.targetHandle,
      type: "bloxd",
      label: spec.label,
      animated: spec.animated,
      data: {
        curveOffset: spec.staggeredOffset,
        bypassOffset: solvedByEdgeId.get(spec.id),
        labelOffset: activeEdgeLabels?.[spec.id],
        elkRoute: activeEdgeRoutes?.[spec.id],
      },
      style: {
        stroke: spec.color,
        strokeWidth: spec.strokeWidth,
        ...(spec.strokeDasharray ? { strokeDasharray: spec.strokeDasharray } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: spec.color,
      },
    }));
  }, [graph, rfNodes, viewMode, layout?.edge_labels, layout?.unified_edge_labels, layout?.edge_routes, layout?.unified_edge_routes]);

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
      const ids = nodes.map((n) => n.id);
      setSelection(ids[0] ?? null, edges[0]?.id ?? null, ids);
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
        selectionOnDrag
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
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
        <Controls className="!border-slate-800 !bg-slate-900 !text-slate-200">
          <ControlButton
            onClick={() => setSettingsOpen((v) => !v)}
            title="Canvas & Wire Settings"
          >
            ⚙
          </ControlButton>
        </Controls>
        {settingsOpen && (
          <div className="pointer-events-auto absolute bottom-4 left-14 z-50 w-64 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-100">
                Canvas Settings
              </span>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="cursor-pointer text-xs text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="mb-1.5 font-medium text-slate-300">
                  Wire Routing Style
                </div>
                <div className="space-y-1">
                  {(
                    [
                      { id: "ortho", label: "90° Rounded (Default)" },
                      { id: "circuit", label: "45° Circuit (PCB)" },
                      { id: "bezier", label: "Smooth Bézier" },
                    ] as { id: WireStyle; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setWireStyle(opt.id)}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-md border px-2.5 py-1.5 text-left transition ${
                        wireStyle === opt.id
                          ? "border-blue-500/60 bg-blue-500/15 text-blue-200"
                          : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {wireStyle === opt.id && (
                        <span className="text-[10px] text-blue-400">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between border-t border-slate-800 pt-2.5 text-slate-300">
                <span>Snap to 20px Grid</span>
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={toggleSnapToGrid}
                  className="accent-blue-500"
                />
              </label>
            </div>
          </div>
        )}
        <MiniMap
          pannable
          zoomable
          nodeColor="#3b82f6"
          maskColor="rgba(2, 6, 23, 0.7)"
          className="!border !border-slate-800 !bg-slate-900"
        />
      </ReactFlow>

      {selectedNodeIds.length >= 2 && (
        <div className="pointer-events-auto absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-blue-500/40 bg-slate-900/95 px-4 py-1.5 text-xs shadow-2xl backdrop-blur-md">
          <span className="font-medium text-slate-200">
            {selectedNodeIds.length} nodes selected
          </span>
          <button
            type="button"
            onClick={() => copySelectedContext()}
            className="cursor-pointer rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            Copy Slice Context (Ctrl+Shift+C)
          </button>
        </div>
      )}

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
