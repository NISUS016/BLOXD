import { create } from "zustand";
import {
  BloxdEdge,
  BloxdNode,
  commands,
  EdgeKind,
  Graph,
  Layout,
  NodeKind,
  NodeLayout,
  ProjectSnapshot,
  Viewport,
} from "../bindings";
import {
  computeDagreLayout,
  computeUnifiedContainerSizes,
  LayoutDirection,
} from "../canvas/layout";

export type ViewMode = "nested" | "unified" | "graph";

export interface ToastState {
  message: string;
  kind: "info" | "success" | "error";
}

interface AddNodeInput {
  title: string;
  kind: NodeKind;
  summary?: string;
  parentId?: string | null;
}

interface AddEdgeInput {
  source: string;
  target: string;
  label?: string | null;
  kind?: EdgeKind;
}

interface ProjectState {
  projectPath: string | null;
  graph: Graph | null;
  layout: Layout | null;
  currentParentId: string | null;
  viewMode: ViewMode;
  layoutDirection: LayoutDirection;
  snapToGrid: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  inspectedNodeId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toast: ToastState | null;

  openProject: (path: string) => Promise<void>;
  applyExternalSnapshot: (snapshot: ProjectSnapshot) => void;
  setCurrentParentId: (parentId: string | null) => void;
  ascendLayer: () => void;
  jumpToNode: (nodeId: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setLayoutDirection: (dir: LayoutDirection) => void;
  toggleSnapToGrid: () => void;
  setSelection: (nodeId: string | null, edgeId: string | null) => void;
  openInspector: (nodeId: string | null) => void;
  showToast: (message: string, kind?: "info" | "success" | "error") => void;
  clearToast: () => void;

  addNode: (input: AddNodeInput) => BloxdNode | null;
  updateNode: (id: string, patch: Partial<BloxdNode>) => void;
  deleteNode: (id: string) => void;

  addEdge: (input: AddEdgeInput) => BloxdEdge | null;
  deleteEdge: (id: string) => void;

  updateNodeLayout: (id: string, patch: Partial<NodeLayout>) => void;
  updateEdgeLabelOffset: (edgeId: string, offset: { x: number; y: number }) => void;
  updateViewport: (layerKey: string, viewport: Viewport) => void;
  autoLayoutCurrentLayer: (direction?: LayoutDirection) => void;
  ensureLayerLayout: (parentId: string | null) => void;
  copyNodeContext: (nodeId: string) => Promise<void>;
}

let graphSaveTimer: ReturnType<typeof setTimeout> | null = null;
let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function slugifyId(title: string, existingIds: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "node";
  if (!existingIds.has(base)) return base;
  let i = 2;
  while (existingIds.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function findFreeSlot(
  siblings: BloxdNode[],
  layout: Layout
): { x: number; y: number } {
  const cols = 3;
  const idx = siblings.length;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  let x = 80 + col * 300;
  let y = 80 + row * 170;

  const occupied = siblings
    .map((n) => layout.nodes[n.id])
    .filter((l): l is NodeLayout => Boolean(l));

  while (
    occupied.some(
      (l) => Math.abs(l.x - x) < 250 && Math.abs(l.y - y) < 130
    )
  ) {
    x += 40;
    y += 40;
  }
  return { x, y };
}

function collectDescendants(nodes: BloxdNode[], rootId: string): Set<string> {
  const toDelete = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const n of nodes) {
      if (n.parent_id && toDelete.has(n.parent_id) && !toDelete.has(n.id)) {
        toDelete.add(n.id);
        added = true;
      }
    }
  }
  return toDelete;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const scheduleSaveGraph = () => {
    if (graphSaveTimer) clearTimeout(graphSaveTimer);
    set({ saving: true });
    graphSaveTimer = setTimeout(async () => {
      const g = get().graph;
      if (!g) return;
      try {
        await commands.saveGraph(g);
        set({ saving: false, error: null });
      } catch (err) {
        set({
          saving: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 300);
  };

  const scheduleSaveLayout = () => {
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    set({ saving: true });
    layoutSaveTimer = setTimeout(async () => {
      const l = get().layout;
      if (!l) return;
      try {
        await commands.saveLayout(l);
        set({ saving: false, error: null });
      } catch (err) {
        set({
          saving: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 300);
  };

  const triggerToast = (
    message: string,
    kind: "info" | "success" | "error" = "info"
  ) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, kind } });
    toastTimer = setTimeout(() => {
      set({ toast: null });
    }, 2600);
  };

  return {
    projectPath: null,
    graph: null,
    layout: null,
    currentParentId: null,
    viewMode: "nested",
    layoutDirection: "LR",
    snapToGrid: true,
    selectedNodeId: null,
    selectedEdgeId: null,
    inspectedNodeId: null,
    loading: false,
    saving: false,
    error: null,
    toast: null,

    showToast: triggerToast,
    clearToast: () => set({ toast: null }),

    openProject: async (path: string) => {
      set({ loading: true, error: null });
      try {
        const snapshot: ProjectSnapshot = await commands.openProject(path);
        set({
          projectPath: snapshot.project_path,
          graph: snapshot.graph,
          layout: snapshot.layout,
          currentParentId: null,
          selectedNodeId: null,
          selectedEdgeId: null,
          loading: false,
        });
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    applyExternalSnapshot: (snapshot) => {
      const { currentParentId, selectedNodeId } = get();
      const nodeIds = new Set(snapshot.graph.nodes.map((n) => n.id));
      set({
        graph: snapshot.graph,
        layout: snapshot.layout,
        currentParentId:
          currentParentId && nodeIds.has(currentParentId)
            ? currentParentId
            : null,
        selectedNodeId:
          selectedNodeId && nodeIds.has(selectedNodeId) ? selectedNodeId : null,
      });
      triggerToast("Synced .bloxd/ changes from disk", "info");
    },

    setCurrentParentId: (parentId) =>
      set({
        currentParentId: parentId,
        selectedNodeId: null,
        selectedEdgeId: null,
        inspectedNodeId: null,
      }),

    ascendLayer: () => {
      const { graph, currentParentId, viewMode } = get();
      if (!graph || viewMode !== "nested" || currentParentId === null) return;
      const current = graph.nodes.find((n) => n.id === currentParentId);
      set({
        currentParentId: current?.parent_id ?? null,
        selectedNodeId: null,
        selectedEdgeId: null,
      });
    },

    jumpToNode: (nodeId) => {
      const { graph } = get();
      if (!graph) return;
      const target = graph.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      set({
        viewMode: "nested",
        currentParentId: target.parent_id ?? null,
        selectedNodeId: target.id,
        selectedEdgeId: null,
      });
    },

    setViewMode: (viewMode) =>
      set({ viewMode, selectedNodeId: null, selectedEdgeId: null }),

    setLayoutDirection: (layoutDirection) => set({ layoutDirection }),

    toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),

    setSelection: (selectedNodeId, selectedEdgeId) =>
      set({ selectedNodeId, selectedEdgeId }),

    openInspector: (inspectedNodeId) =>
      set({
        inspectedNodeId,
        selectedNodeId: inspectedNodeId,
        selectedEdgeId: null,
      }),

    addNode: ({ title, kind, summary = "", parentId }) => {
      const { graph, layout, currentParentId } = get();
      if (!graph || !layout) return null;

      const resolvedParent = parentId !== undefined ? parentId : currentParentId;
      const existingIds = new Set(graph.nodes.map((n) => n.id));
      const id = slugifyId(title, existingIds);

      const newNode: BloxdNode = {
        id,
        title: title.trim() || id,
        kind,
        parent_id: resolvedParent,
        status: "planned",
        summary: summary.trim(),
        linked_files: [],
        spec_file: `specs/${id}.md`,
      };

      const siblings = graph.nodes.filter(
        (n) => (n.parent_id ?? null) === resolvedParent
      );
      const slot = findFreeSlot(siblings, layout);

      const nextGraph: Graph = {
        ...graph,
        updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        nodes: [...graph.nodes, newNode],
      };

      const nextLayout: Layout = {
        ...layout,
        nodes: {
          ...layout.nodes,
          [id]: {
            x: slot.x,
            y: slot.y,
            width: 260,
            height: 136,
          },
        },
      };

      set({
        graph: nextGraph,
        layout: nextLayout,
        selectedNodeId: id,
        selectedEdgeId: null,
      });
      scheduleSaveGraph();
      scheduleSaveLayout();
      return newNode;
    },

    updateNode: (id, patch) => {
      const { graph } = get();
      if (!graph) return;
      const nextGraph: Graph = {
        ...graph,
        updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      };
      set({ graph: nextGraph });
      scheduleSaveGraph();
    },

    deleteNode: (id) => {
      const { graph, layout, currentParentId, selectedNodeId } = get();
      if (!graph || !layout) return;

      const toDelete = collectDescendants(graph.nodes, id);
      const nextNodes = graph.nodes.filter((n) => !toDelete.has(n.id));
      const nextEdges = graph.edges.filter(
        (e) => !toDelete.has(e.source) && !toDelete.has(e.target)
      );

      const nextLayoutNodes = { ...layout.nodes };
      for (const delId of toDelete) {
        delete nextLayoutNodes[delId];
      }

      const nextParent =
        currentParentId && toDelete.has(currentParentId)
          ? null
          : currentParentId;

      set({
        graph: {
          ...graph,
          updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          nodes: nextNodes,
          edges: nextEdges,
        },
        layout: {
          ...layout,
          nodes: nextLayoutNodes,
        },
        currentParentId: nextParent,
        selectedNodeId:
          selectedNodeId && toDelete.has(selectedNodeId)
            ? null
            : selectedNodeId,
        inspectedNodeId:
          get().inspectedNodeId && toDelete.has(get().inspectedNodeId!)
            ? null
            : get().inspectedNodeId,
      });
      scheduleSaveGraph();
      scheduleSaveLayout();
    },

    addEdge: ({ source, target, label = null, kind = "dependency" }) => {
      const { graph } = get();
      if (!graph || source === target) return null;

      const duplicate = graph.edges.some(
        (e) => e.source === source && e.target === target
      );
      if (duplicate) return null;

      const existingIds = new Set(graph.edges.map((e) => e.id));
      const id = slugifyId(`e-${source}-${target}`, existingIds);
      const newEdge: BloxdEdge = { id, source, target, label, kind };

      set({
        graph: {
          ...graph,
          updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          edges: [...graph.edges, newEdge],
        },
      });
      scheduleSaveGraph();
      return newEdge;
    },

    deleteEdge: (id) => {
      const { graph, selectedEdgeId } = get();
      if (!graph) return;
      set({
        graph: {
          ...graph,
          updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          edges: graph.edges.filter((e) => e.id !== id),
        },
        selectedEdgeId: selectedEdgeId === id ? null : selectedEdgeId,
      });
      scheduleSaveGraph();
    },

    updateNodeLayout: (id, patch) => {
      const { layout } = get();
      if (!layout) return;
      const current = layout.nodes[id] ?? {
        x: 100,
        y: 100,
        width: 240,
        height: 110,
      };
      set({
        layout: {
          ...layout,
          nodes: {
            ...layout.nodes,
            [id]: { ...current, ...patch },
          },
        },
      });
      scheduleSaveLayout();
    },

    updateEdgeLabelOffset: (edgeId, offset) => {
      const { layout } = get();
      if (!layout) return;
      set({
        layout: {
          ...layout,
          edge_labels: {
            ...(layout.edge_labels ?? {}),
            [edgeId]: {
              x: Math.round(offset.x),
              y: Math.round(offset.y),
            },
          },
        },
      });
      scheduleSaveLayout();
    },

    updateViewport: (layerKey, viewport) => {
      const { layout } = get();
      if (!layout) return;
      const prev = layout.viewports[layerKey];
      if (
        prev &&
        Math.abs(prev.x - viewport.x) < 0.5 &&
        Math.abs(prev.y - viewport.y) < 0.5 &&
        Math.abs(prev.zoom - viewport.zoom) < 0.005
      ) {
        return;
      }
      set({
        layout: {
          ...layout,
          viewports: {
            ...layout.viewports,
            [layerKey]: viewport,
          },
        },
      });
      scheduleSaveLayout();
    },

    autoLayoutCurrentLayer: (direction) => {
      const { graph, layout, currentParentId, viewMode, layoutDirection } =
        get();
      if (!graph || !layout) return;

      const dir = direction ?? layoutDirection;
      const nextNodesLayout = { ...layout.nodes };

      if (viewMode === "nested") {
        const layerNodes = graph.nodes.filter(
          (n) => (n.parent_id ?? null) === currentParentId
        );
        if (layerNodes.length === 0) return;

        // Include rolled-up edges between visible ancestors so Dagre arranges connected hubs cleanly
        const visibleIds = new Set(layerNodes.map((n) => n.id));
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

        const layoutEdges: BloxdEdge[] = [...graph.edges];
        for (const e of graph.edges) {
          const src = findVisibleAncestor(e.source);
          const dst = findVisibleAncestor(e.target);
          if (src && dst && src !== dst) {
            layoutEdges.push({
              id: `virt-${src}-${dst}`,
              source: src,
              target: dst,
              label: null,
              kind: e.kind,
            });
          }
        }

        const positions = computeDagreLayout(
          layerNodes,
          layoutEdges,
          dir,
          nextNodesLayout
        );
        for (const [id, pos] of Object.entries(positions)) {
          const prev = nextNodesLayout[id] ?? {
            x: pos.x,
            y: pos.y,
            width: 260,
            height: 136,
          };
          nextNodesLayout[id] = { ...prev, x: pos.x, y: pos.y };
        }
      } else {
        // Bottom-up layout for Unified mode: lay out children first, then size containers, then lay out parents.
        const byId = new Map(graph.nodes.map((n) => [n.id, n]));
        const depthOf = (id: string, seen = new Set<string>()): number => {
          if (seen.has(id)) return 0;
          seen.add(id);
          const n = byId.get(id);
          return n?.parent_id && byId.has(n.parent_id)
            ? 1 + depthOf(n.parent_id, seen)
            : 0;
        };

        const groupsByParent = new Map<string | null, BloxdNode[]>();
        for (const n of graph.nodes) {
          const key = n.parent_id ?? null;
          const list = groupsByParent.get(key) ?? [];
          list.push(n);
          groupsByParent.set(key, list);
        }

        const parentKeys = [...groupsByParent.keys()].sort((a, b) => {
          const da = a === null ? -1 : depthOf(a);
          const db = b === null ? -1 : depthOf(b);
          return db - da;
        });

        for (const parentKey of parentKeys) {
          const layerNodes = groupsByParent.get(parentKey) ?? [];
          if (layerNodes.length === 0) continue;

          const containerSizes = computeUnifiedContainerSizes(
            graph.nodes,
            nextNodesLayout
          );
          const marginTop = parentKey === null ? 50 : 112;
          let edgesForLayer: BloxdEdge[] = graph.edges;
          if (parentKey === null) {
            // Roll up cross-layer edges onto root containers so Unified mode arranges them in a clean 2D flow
            const rootIds = new Set(layerNodes.map((n) => n.id));
            const findRoot = (id: string): string | null => {
              let cur: string | undefined | null = id;
              const seen = new Set<string>();
              while (cur && !seen.has(cur)) {
                if (rootIds.has(cur)) return cur;
                seen.add(cur);
                cur = byId.get(cur)?.parent_id;
              }
              return null;
            };
            edgesForLayer = [...graph.edges];
            for (const e of graph.edges) {
              const src = findRoot(e.source);
              const dst = findRoot(e.target);
              if (src && dst && src !== dst) {
                edgesForLayer.push({
                  id: `virt-root-${src}-${dst}`,
                  source: src,
                  target: dst,
                  label: null,
                  kind: e.kind,
                });
              }
            }
          }
          const positions = computeDagreLayout(
            layerNodes,
            edgesForLayer,
            dir,
            nextNodesLayout,
            containerSizes,
            marginTop
          );

          for (const [id, pos] of Object.entries(positions)) {
            const prev = nextNodesLayout[id] ?? {
              x: pos.x,
              y: pos.y,
              width: 260,
              height: 136,
            };
            nextNodesLayout[id] = { ...prev, x: pos.x, y: pos.y };
          }
        }
      }

      set({
        layoutDirection: dir,
        layout: {
          ...layout,
          nodes: nextNodesLayout,
        },
      });
      scheduleSaveLayout();
      triggerToast(`Auto-layout applied (${dir})`, "info");
    },

    ensureLayerLayout: (parentId) => {
      const { graph, layout, layoutDirection } = get();
      if (!graph || !layout) return;

      const layerNodes = graph.nodes.filter(
        (n) => (n.parent_id ?? null) === parentId
      );
      if (layerNodes.length === 0) return;

      const missing = layerNodes.filter((n) => !layout.nodes[n.id]);
      if (missing.length === 0) return;

      const nextNodesLayout = { ...layout.nodes };
      if (missing.length === layerNodes.length) {
        // Newly added layer with no saved layout.json positions: auto-run Dagre.
        const positions = computeDagreLayout(
          layerNodes,
          graph.edges,
          layoutDirection,
          nextNodesLayout
        );
        for (const [id, pos] of Object.entries(positions)) {
          nextNodesLayout[id] = {
            x: pos.x,
            y: pos.y,
            width: 260,
            height: 136,
          };
        }
      } else {
        // Partial addition: place only missing nodes without disturbing existing positions.
        for (const n of missing) {
          const placedSiblings = layerNodes.filter((s) => nextNodesLayout[s.id]);
          const slot = findFreeSlot(placedSiblings, {
            ...layout,
            nodes: nextNodesLayout,
          });
          nextNodesLayout[n.id] = {
            x: slot.x,
            y: slot.y,
            width: 240,
            height: 110,
          };
        }
      }

      set({
        layout: {
          ...layout,
          nodes: nextNodesLayout,
        },
      });
      scheduleSaveLayout();
    },

    copyNodeContext: async (nodeId) => {
      try {
        const markdown = await commands.exportNodeContext(nodeId);
        await navigator.clipboard.writeText(markdown);
        triggerToast(`Copied scoped context for "${nodeId}"`, "success");
      } catch (err) {
        triggerToast(
          err instanceof Error ? err.message : "Failed to export context",
          "error"
        );
      }
    },
  };
});
