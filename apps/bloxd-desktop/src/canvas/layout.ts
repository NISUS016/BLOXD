import dagre from "@dagrejs/dagre";
import { BloxdEdge, BloxdNode, NodeLayout } from "../bindings";

export type LayoutDirection = "LR" | "TB";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 136;

/**
 * Runs Dagre layout for a single layer's nodes and internal edges.
 * Optional `sizeOverrides` lets Unified mode lay out parent containers using their expanded sizes.
 */
export function computeDagreLayout(
  nodes: BloxdNode[],
  edges: BloxdEdge[],
  direction: LayoutDirection,
  existingLayout: Record<string, NodeLayout>,
  sizeOverrides?: Record<string, { width: number; height: number }>,
  marginTop = 60
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 56,
    ranksep: 84,
    marginx: 50,
    marginy: marginTop,
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const n of nodes) {
    const override = sizeOverrides?.[n.id];
    const saved = existingLayout[n.id];
    g.setNode(n.id, {
      width: override?.width ?? saved?.width ?? DEFAULT_WIDTH,
      height: override?.height ?? saved?.height ?? DEFAULT_HEIGHT,
    });
  }

  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  const result: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) {
      result[n.id] = {
        x: Math.round(pos.x - pos.width / 2),
        y: Math.round(pos.y - pos.height / 2),
      };
    }
  }

  return result;
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
        x: 40 + (idx % 3) * 290,
        y: 112 + Math.floor(idx / 3) * 160,
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
