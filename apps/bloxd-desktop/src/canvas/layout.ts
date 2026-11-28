import ELK, { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import { BloxdEdge, BloxdNode, NodeLayout } from "../bindings";

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

  const nodePositions: Record<string, { x: number; y: number }> = {};
  if (result.children) {
    for (const child of result.children) {
      nodePositions[child.id] = {
        x: Math.round(child.x ?? 0),
        y: Math.round(child.y ?? 0),
      };
    }
  }

  return { nodePositions };
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

  // Ancestor chain from root -> ... -> parent_id -> id
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

  // Group every edge under its Lowest Common Ancestor container (null = root)
  const edgesByLca = new Map<string | null, ElkExtendedEdge[]>();
  const seenPairs = new Set<string>();

  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const pairKey = `${e.source}->${e.target}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const srcChain = getAncestors(e.source);
    const dstChain = getAncestors(e.target);

    // Skip direct ancestor <-> descendant self-containment edges in ELK hierarchy
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

  const nodePositions: Record<string, { x: number; y: number }> = {};
  const containerSizes: Record<string, { width: number; height: number }> = {};

  const extractPositions = (elkNode: ElkNode) => {
    if (!elkNode.children) return;
    for (const child of elkNode.children) {
      nodePositions[child.id] = {
        x: Math.round(child.x ?? 0),
        y: Math.round(child.y ?? 0),
      };
      if (child.children && child.children.length > 0 && child.width && child.height) {
        containerSizes[child.id] = {
          width: Math.round(child.width),
          height: Math.round(child.height),
        };
        extractPositions(child);
      }
    }
  };

  extractPositions(result);

  return { nodePositions, containerSizes };
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
 * Synchronous spacious grid fallback used only before ELK resolves on brand-new layers.
 */
export function computeFallbackGridLayout(
  nodes: BloxdNode[],
  direction: LayoutDirection,
  marginTop = 60
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(nodes.length))));
  const gapX = direction === "LR" ? 380 : 340;
  const gapY = direction === "LR" ? 210 : 220;

  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    result[n.id] = {
      x: 50 + col * gapX,
      y: marginTop + row * gapY,
    };
  });

  return result;
}
