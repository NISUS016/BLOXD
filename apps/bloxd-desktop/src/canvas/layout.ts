import ELK, { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import { BloxdEdge, BloxdNode, EdgeRoute, HandleSide, NodeLayout, Point2D } from "../bindings";

export type LayoutDirection = "LR" | "TB";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 136;

// Approximate edge label pill dimensions
const LABEL_CHAR_WIDTH = 6.3;
const LABEL_H_PAD = 28;
const LABEL_MAX_WIDTH = 210;
const LABEL_HEIGHT = 28;

export function estimateLabelWidth(label: string): number {
  return Math.min(
    LABEL_MAX_WIDTH,
    Math.round(Math.min(34, label.length) * LABEL_CHAR_WIDTH + LABEL_H_PAD)
  );
}

const elk = new ELK();

export interface ElkLayoutResult {
  nodePositions: Record<string, { x: number; y: number }>;
  containerSizes?: Record<string, { width: number; height: number }>;
  edgeRoutes: Record<string, EdgeRoute>;
}

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Infers which node border ("top" | "bottom" | "left" | "right") an ELK port/endpoint touches.
 */
function inferHandleSide(pt: Point2D, box?: BoxRect): HandleSide {
  if (!box) return "right";
  const dLeft = Math.abs(pt.x - box.x);
  const dRight = Math.abs(pt.x - (box.x + box.width));
  const dTop = Math.abs(pt.y - box.y);
  const dBottom = Math.abs(pt.y - (box.y + box.height));
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dTop) return "top";
  if (min === dBottom) return "bottom";
  if (min === dLeft) return "left";
  return "right";
}

/**
 * Extracts node positions (local to each parent) plus world-coordinate ELK edge routes & label anchors.
 */
function extractElkResult(result: ElkNode): ElkLayoutResult {
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const containerSizes: Record<string, { width: number; height: number }> = {};
  const worldRects = new Map<string, BoxRect>();
  const edgeRoutes: Record<string, EdgeRoute> = {};

  const collectNodes = (elkNode: ElkNode, parentWorldX: number, parentWorldY: number) => {
    if (!elkNode.children) return;
    for (const child of elkNode.children) {
      const lx = Math.round(child.x ?? 0);
      const ly = Math.round(child.y ?? 0);
      const wx = parentWorldX + lx;
      const wy = parentWorldY + ly;
      const w = Math.round(child.width ?? DEFAULT_WIDTH);
      const h = Math.round(child.height ?? DEFAULT_HEIGHT);

      nodePositions[child.id] = { x: lx, y: ly };
      worldRects.set(child.id, { x: wx, y: wy, width: w, height: h });

      if (child.children && child.children.length > 0) {
        if (child.width && child.height) {
          containerSizes[child.id] = { width: w, height: h };
        }
        collectNodes(child, wx, wy);
      }
    }
  };

  const collectRoutes = (elkNode: ElkNode, parentWorldX: number, parentWorldY: number) => {
    if (elkNode.edges) {
      for (const edge of elkNode.edges as ElkExtendedEdge[]) {
        const section = edge.sections?.[0];
        if (!section) continue;

        const rawPts = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ];
        const points: Point2D[] = rawPts.map((p) => ({
          x: Math.round(parentWorldX + p.x),
          y: Math.round(parentWorldY + p.y),
        }));
        if (points.length < 2) continue;

        let labelPos: Point2D | null = null;
        const lbl = edge.labels?.[0];
        if (lbl && lbl.x !== undefined && lbl.y !== undefined) {
          labelPos = {
            x: Math.round(parentWorldX + lbl.x + (lbl.width ?? 0) / 2),
            y: Math.round(parentWorldY + lbl.y + (lbl.height ?? 0) / 2),
          };
        }

        const srcId = edge.sources?.[0];
        const dstId = edge.targets?.[0];
        edgeRoutes[edge.id] = {
          points,
          label_pos: labelPos,
          source_side: inferHandleSide(points[0], srcId ? worldRects.get(srcId) : undefined),
          target_side: inferHandleSide(
            points[points.length - 1],
            dstId ? worldRects.get(dstId) : undefined
          ),
        };
      }
    }

    if (elkNode.children) {
      for (const child of elkNode.children) {
        if (child.children && child.children.length > 0) {
          const wr = worldRects.get(child.id);
          const wx = wr ? wr.x : parentWorldX + Math.round(child.x ?? 0);
          const wy = wr ? wr.y : parentWorldY + Math.round(child.y ?? 0);
          collectRoutes(child, wx, wy);
        }
      }
    }
  };

  collectNodes(result, 0, 0);
  collectRoutes(result, 0, 0);

  return {
    nodePositions,
    containerSizes: Object.keys(containerSizes).length > 0 ? containerSizes : undefined,
    edgeRoutes,
  };
}

/**
 * Runs ELK layered layout for a single flat layer (Nested mode).
 * Passes edge label dimensions so ELK allocates spacious rank/node gaps for pills.
 */
export async function computeElkLayout(
  nodes: BloxdNode[],
  edges: BloxdEdge[],
  direction: LayoutDirection,
  existingLayout: Record<string, NodeLayout>,
  marginTop = 60
): Promise<ElkLayoutResult> {
  const nodeIds = new Set(nodes.map((n) => n.id));

  const elkNodes: ElkNode[] = nodes.map((n) => {
    const saved = existingLayout[n.id];
    const w = Math.max(saved?.width ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
    const h = Math.max(saved?.height ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);
    return {
      id: n.id,
      width: w,
      height: h,
    };
  });

  const seenEdgePairs = new Set<string>();
  const elkEdges: ElkExtendedEdge[] = [];

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    const pairKey = `${e.source}->${e.target}`;
    if (seenEdgePairs.has(pairKey)) continue;
    seenEdgePairs.add(pairKey);

    const elkEdge: ElkExtendedEdge = {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    };
    if (e.label) {
      elkEdge.labels = [
        {
          id: `label-${e.id}`,
          text: e.label,
          width: estimateLabelWidth(e.label),
          height: LABEL_HEIGHT,
          layoutOptions: {
            "edgeLabels.placement": "CENTER",
          },
        },
      ];
    }

    elkEdges.push(elkEdge);
  }

  const graph: ElkNode = {
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "LR" ? "RIGHT" : "DOWN",
      "elk.spacing.nodeNode": "72",
      "elk.layered.spacing.nodeNodeBetweenLayers": direction === "LR" ? "160" : "120",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "24",
      "elk.spacing.edgeLabel": "14",
      "elk.spacing.labelNode": "22",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.padding": `[top=${marginTop},left=50,bottom=40,right=50]`,
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    },
  };

  const result = await elk.layout(graph);
  return extractElkResult(result);
}

/**
 * Runs ELK hierarchical layout (Unified mode) with `INCLUDE_CHILDREN`.
 * Cross-container edges attach to their Lowest Common Ancestor so ELK
 * aligns connected child cards toward container boundaries and reserves corridor space.
 */
export async function computeElkHierarchicalLayout(
  allNodes: BloxdNode[],
  edges: BloxdEdge[],
  direction: LayoutDirection,
  existingLayout: Record<string, NodeLayout>
): Promise<ElkLayoutResult> {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string | null, BloxdNode[]>();

  for (const n of allNodes) {
    const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null;
    const list = childrenByParent.get(key) ?? [];
    list.push(n);
    childrenByParent.set(key, list);
  }

  const getAncestors = (id: string): string[] => {
    const chain: string[] = [];
    let cur: string | null | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur) && byId.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = byId.get(cur)?.parent_id;
    }
    return chain.reverse();
  };

  const edgesByLca = new Map<string | null, ElkExtendedEdge[]>();
  const seenPairs = new Set<string>();

  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const pairKey = `${e.source}->${e.target}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const srcChain = getAncestors(e.source);
    const dstChain = getAncestors(e.target);

    if (srcChain.includes(e.target) || dstChain.includes(e.source)) continue;

    let lca: string | null = null;
    const minLen = Math.min(srcChain.length, dstChain.length);
    for (let i = 0; i < minLen; i++) {
      if (srcChain[i] === dstChain[i]) {
        lca = srcChain[i];
      } else {
        break;
      }
    }

    const elkEdge: ElkExtendedEdge = {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    };
    if (e.label) {
      elkEdge.labels = [
        {
          id: `label-${e.id}`,
          text: e.label,
          width: estimateLabelWidth(e.label),
          height: LABEL_HEIGHT,
          layoutOptions: { "edgeLabels.placement": "CENTER" },
        },
      ];
    }

    const list = edgesByLca.get(lca) ?? [];
    list.push(elkEdge);
    edgesByLca.set(lca, list);
  }

  const buildElkNode = (n: BloxdNode): ElkNode => {
    const saved = existingLayout[n.id];
    const children = childrenByParent.get(n.id) ?? [];
    const isContainer = children.length > 0;
    const w = Math.max(saved?.width ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
    const h = Math.max(saved?.height ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);
    const internalEdges = edgesByLca.get(n.id) ?? [];

    // Note: never attach explicit `undefined` keys to ElkNode — ELK's GWT runtime crashes on them.
    if (isContainer) {
      const containerNode: ElkNode = {
        id: n.id,
        children: children.map(buildElkNode),
        layoutOptions: {
          "elk.padding": "[top=112,left=36,bottom=36,right=36]",
          "elk.spacing.nodeNode": "56",
          "elk.layered.spacing.nodeNodeBetweenLayers": direction === "LR" ? "120" : "96",
          "elk.spacing.edgeNode": "32",
          "elk.spacing.edgeEdge": "18",
          "elk.spacing.edgeLabel": "10",
          "elk.spacing.labelNode": "18",
          "elk.edgeLabels.placement": "CENTER",
        },
      };
      if (internalEdges.length > 0) {
        containerNode.edges = internalEdges;
      }
      return containerNode;
    }

    return {
      id: n.id,
      width: w,
      height: h,
    };
  };

  const rootNodes = childrenByParent.get(null) ?? [];
  const rootEdges = edgesByLca.get(null) ?? [];

  const graph: ElkNode = {
    id: "root",
    children: rootNodes.map(buildElkNode),
    edges: rootEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "LR" ? "RIGHT" : "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "68",
      "elk.layered.spacing.nodeNodeBetweenLayers": direction === "LR" ? "150" : "120",
      "elk.spacing.edgeNode": "38",
      "elk.spacing.edgeEdge": "20",
      "elk.spacing.edgeLabel": "12",
      "elk.spacing.labelNode": "20",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.padding": "[top=50,left=50,bottom=40,right=50]",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    },
  };

  const result = await elk.layout(graph);
  return extractElkResult(result);
}

/**
 * Computes container widths and heights in Unified mode so children fit inside with padding.
 */
export function computeUnifiedContainerSizes(
  nodes: BloxdNode[],
  layoutNodes: Record<string, NodeLayout>
): Record<string, { width: number; height: number }> {
  const childrenByParent = new Map<string, BloxdNode[]>();
  for (const n of nodes) {
    if (n.parent_id) {
      const list = childrenByParent.get(n.parent_id) ?? [];
      list.push(n);
      childrenByParent.set(n.parent_id, list);
    }
  }

  const sizes: Record<string, { width: number; height: number }> = {};

  const computeSize = (
    node: BloxdNode,
    visiting = new Set<string>()
  ): { width: number; height: number } => {
    if (sizes[node.id]) return sizes[node.id];
    const saved = layoutNodes[node.id];
    const baseWidth = Math.max(saved?.width ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
    const baseHeight = Math.max(saved?.height ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);

    if (visiting.has(node.id)) {
      return { width: baseWidth, height: baseHeight };
    }
    visiting.add(node.id);

    const children = childrenByParent.get(node.id) ?? [];
    if (children.length === 0) {
      const leafSize = { width: baseWidth, height: baseHeight };
      sizes[node.id] = leafSize;
      return leafSize;
    }

    let maxRight = 0;
    let maxBottom = 0;

    children.forEach((child, idx) => {
      const childSize = computeSize(child, visiting);
      const childPos = layoutNodes[child.id] ?? {
        x: 40 + (idx % 3) * 310,
        y: 112 + Math.floor(idx / 3) * 180,
      };
      maxRight = Math.max(maxRight, childPos.x + childSize.width);
      maxBottom = Math.max(maxBottom, childPos.y + childSize.height);
    });

    const containerSize = {
      width: Math.max(baseWidth, maxRight + 36),
      height: Math.max(baseHeight, maxBottom + 36),
    };
    sizes[node.id] = containerSize;
    return containerSize;
  };

  for (const n of nodes) {
    computeSize(n);
  }

  return sizes;
}

/**
 * Size-aware synchronous grid fallback so even large Unified containers never overlap
 * if ELK is unavailable or before an async ELK pass resolves.
 */
export function computeFallbackGridLayout(
  nodes: BloxdNode[],
  direction: LayoutDirection,
  marginTop = 60,
  sizes?: Record<string, { width: number; height: number }>,
  existingLayout?: Record<string, NodeLayout>
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return result;

  const cols = direction === "LR" ? Math.max(2, Math.min(4, Math.ceil(Math.sqrt(nodes.length)))) : Math.max(1, Math.min(3, Math.ceil(Math.sqrt(nodes.length))));
  const gap = 80;
  const startX = 50;

  let curX = startX;
  let curY = marginTop;
  let rowMaxH = 0;

  nodes.forEach((n, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) {
      curX = startX;
      curY += rowMaxH + gap;
      rowMaxH = 0;
    }

    const s = sizes?.[n.id] ?? existingLayout?.[n.id];
    const w = Math.max(s?.width ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
    const h = Math.max(s?.height ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);

    result[n.id] = { x: Math.round(curX), y: Math.round(curY) };
    curX += w + gap;
    rowMaxH = Math.max(rowMaxH, h);
  });

  return result;
}
