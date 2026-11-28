import { create } from "zustand";
import {
  BloxdEdge,
  BloxdNode,
  ChecklistProgress,
  commands,
  DriftReport,
  EdgeKind,
  Graph,
  Layout,
  NodeKind,
  NodeLayout,
  ProjectSnapshot,
  Viewport,
} from "../bindings";
import {
  computeElkLayout,
  computeElkHierarchicalLayout,
  computeFallbackGridLayout,
  LayoutDirection,
} from "../canvas/layout";

export type ViewMode = "nested" | "unified" | "graph";
export type WireStyle = "ortho" | "circuit" | "bezier";

const WIRE_STYLE_KEY = "bloxd.wireStyle";

function loadInitialWireStyle(): WireStyle {
  try {
    const saved = localStorage.getItem(WIRE_STYLE_KEY);
    if (saved === "ortho" || saved === "circuit" || saved === "bezier") {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return "ortho";
}

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

interface HistoryEntry {
  graph: Graph;
  layout: Layout;
}

const MAX_UNDO_HISTORY = 50;

interface ProjectState {
  projectPath: string | null;
  graph: Graph | null;
  layout: Layout | null;
  currentParentId: string | null;
  layerHistory: (string | null)[];
  historyIndex: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  viewMode: ViewMode;
  wireStyle: WireStyle;
  layoutDirection: LayoutDirection;
  snapToGrid: boolean;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  inspectedNodeId: string | null;
  checklists: Record<string, ChecklistProgress>;
  drift: DriftReport | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toast: ToastState | null;

  openProject: (path: string) => Promise<void>;
  applyExternalSnapshot: (snapshot: ProjectSnapshot) => void;
  setCurrentParentId: (parentId: string | null) => void;
  goBackLayer: () => void;
  goForwardLayer: () => void;
  ascendLayer: () => void;
  jumpToNode: (nodeId: string) => void;
  undo: () => void;
  redo: () => void;
  setViewMode: (mode: ViewMode) => void;
  setWireStyle: (style: WireStyle) => void;
  setLayoutDirection: (dir: LayoutDirection) => void;
  toggleSnapToGrid: () => void;
  setSelection: (nodeId: string | null, edgeId: string | null, nodeIds?: string[]) => void;
  openInspector: (nodeId: string | null) => void;
  updateSpecChecklist: (nodeId: string, specText: string) => void;
  checkDrift: () => Promise<void>;
  markSynced: (nodeIds: string[]) => Promise<void>;
  copyDriftSyncPrompt: (nodeIds: string[]) => Promise<void>;
  copySelectedContext: () => Promise<void>;
  showToast: (message: string, kind?: "info" | "success" | "error") => void;
  clearToast: () => void;

  addNode: (input: AddNodeInput) => BloxdNode | null;
  updateNode: (id: string, patch: Partial<BloxdNode>) => void;
  deleteNode: (id: string) => void;

  addEdge: (input: AddEdgeInput) => BloxdEdge | null;
  deleteEdge: (id: string) => void;

  updateNodeLayout: (id: string, patch: Partial<NodeLayout>) => void;
  updateEdgeLabelOffset: (edgeId: string, offset: { x: number; y: number } | null) => void;
  updateViewport: (layerKey: string, viewport: Viewport) => void;
  autoLayoutCurrentLayer: (direction?: LayoutDirection) => Promise<void>;
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
    layerHistory: [null],
    historyIndex: 0,
    undoStack: [],
    redoStack: [],
    viewMode: "nested",
    wireStyle: loadInitialWireStyle(),
    layoutDirection: "LR",
    snapToGrid: true,
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeId: null,
    inspectedNodeId: null,
    checklists: {},
    drift: null,
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
          checklists: snapshot.checklists ?? {},
          currentParentId: null,
          layerHistory: [null],
          historyIndex: 0,
          undoStack: [],
          redoStack: [],
          selectedNodeId: null,
          selectedNodeIds: [],
          selectedEdgeId: null,
          inspectedNodeId: null,
          loading: false,
        });
        get().checkDrift();
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    applyExternalSnapshot: (snapshot) => {
      const { currentParentId, selectedNodeId, selectedNodeIds } = get();
      const nodeIds = new Set(snapshot.graph.nodes.map((n) => n.id));
      set({
        graph: snapshot.graph,
        layout: snapshot.layout,
        checklists: snapshot.checklists ?? {},
        currentParentId:
          currentParentId && nodeIds.has(currentParentId)
            ? currentParentId
            : null,
        selectedNodeId:
          selectedNodeId && nodeIds.has(selectedNodeId) ? selectedNodeId : null,
        selectedNodeIds: selectedNodeIds.filter((id) => nodeIds.has(id)),
      });
      get().checkDrift();
      triggerToast("Synced .bloxd/ changes from disk", "info");
    },

    setCurrentParentId: (parentId) => {
      const { layerHistory, historyIndex } = get();
      if (layerHistory[historyIndex] === parentId) {
        set({
          currentParentId: parentId,
          selectedNodeId: null,
          selectedEdgeId: null,
          inspectedNodeId: null,
        });
        return;
      }
      const nextHistory = [...layerHistory.slice(0, historyIndex + 1), parentId];
      set({
        currentParentId: parentId,
        layerHistory: nextHistory,
        historyIndex: nextHistory.length - 1,
        selectedNodeId: null,
        selectedEdgeId: null,
        inspectedNodeId: null,
      });
    },

    goBackLayer: () => {
      const { layerHistory, historyIndex } = get();
      if (historyIndex <= 0) return;
      const nextIndex = historyIndex - 1;
      set({
        viewMode: "nested",
        historyIndex: nextIndex,
        currentParentId: layerHistory[nextIndex],
        selectedNodeId: null,
        selectedEdgeId: null,
        inspectedNodeId: null,
      });
    },

    goForwardLayer: () => {
      const { layerHistory, historyIndex } = get();
      if (historyIndex >= layerHistory.length - 1) return;
      const nextIndex = historyIndex + 1;
      set({
        viewMode: "nested",
        historyIndex: nextIndex,
        currentParentId: layerHistory[nextIndex],
        selectedNodeId: null,
        selectedEdgeId: null,
        inspectedNodeId: null,
      });
    },

    ascendLayer: () => {
      const { graph, currentParentId, viewMode } = get();
      if (!graph || viewMode !== "nested" || currentParentId === null) return;
      const current = graph.nodes.find((n) => n.id === currentParentId);
      get().setCurrentParentId(current?.parent_id ?? null);
    },

    jumpToNode: (nodeId) => {
      const { graph } = get();
      if (!graph) return;
      const target = graph.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      const targetParent = target.parent_id ?? null;
      get().setCurrentParentId(targetParent);
      set({
        viewMode: "nested",
        selectedNodeId: target.id,
        selectedEdgeId: null,
      });
    },

    undo: () => {
      const { graph, layout, undoStack, redoStack } = get();
      if (!graph || !layout || undoStack.length === 0) return;
      const previous = undoStack[undoStack.length - 1];
      const nextUndo = undoStack.slice(0, -1);
      const nextRedo = [
        ...redoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);

      set({
        graph: previous.graph,
        layout: previous.layout,
        undoStack: nextUndo,
        redoStack: nextRedo,
      });
      scheduleSaveGraph();
      scheduleSaveLayout();
      triggerToast("Undid last change", "info");
    },

    redo: () => {
      const { graph, layout, undoStack, redoStack } = get();
      if (!graph || !layout || redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1];
      const nextRedo = redoStack.slice(0, -1);
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);

      set({
        graph: next.graph,
        layout: next.layout,
        undoStack: nextUndo,
        redoStack: nextRedo,
      });
      scheduleSaveGraph();
      scheduleSaveLayout();
      triggerToast("Redid change", "info");
    },

    setViewMode: (viewMode) =>
      set({ viewMode, selectedNodeId: null, selectedEdgeId: null }),

    setWireStyle: (wireStyle) => {
      try {
        localStorage.setItem(WIRE_STYLE_KEY, wireStyle);
      } catch {
        // ignore
      }
      set({ wireStyle });
    },

    setLayoutDirection: (layoutDirection) => set({ layoutDirection }),

    toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),

    setSelection: (selectedNodeId, selectedEdgeId, nodeIds) =>
      set({
        selectedNodeId,
        selectedNodeIds: nodeIds ?? (selectedNodeId ? [selectedNodeId] : []),
        selectedEdgeId,
      }),

    openInspector: (inspectedNodeId) =>
      set({
        inspectedNodeId,
        selectedNodeId: inspectedNodeId,
        selectedNodeIds: inspectedNodeId ? [inspectedNodeId] : [],
        selectedEdgeId: null,
      }),

    updateSpecChecklist: (nodeId, specText) => {
      let done = 0;
      let total = 0;
      for (const line of specText.split(/\r?\n/)) {
        const t = line.trimStart();
        const body = t.startsWith("- ") ? t.slice(2) : t.startsWith("* ") ? t.slice(2) : null;
        if (!body) continue;
        if (body.startsWith("[ ] ") || body === "[ ]") {
          total += 1;
        } else if (
          body.startsWith("[x] ") ||
          body.startsWith("[X] ") ||
          body === "[x]" ||
          body === "[X]"
        ) {
          total += 1;
          done += 1;
        }
      }
      set((s) => {
        const next = { ...s.checklists };
        if (total > 0) {
          next[nodeId] = { done, total };
        } else {
          delete next[nodeId];
        }
        return { checklists: next };
      });
    },

    checkDrift: async () => {
      if (!get().projectPath) return;
      try {
        const drift = await commands.checkGitDrift();
        set({ drift });
      } catch {
        // ignore if project not open
      }
    },

    markSynced: async (nodeIds) => {
      try {
        await commands.markNodesSynced(nodeIds);
        await get().checkDrift();
        triggerToast(
          nodeIds.length === 0 ? "Marked all nodes synced" : `Marked ${nodeIds.length} node(s) synced`,
          "success"
        );
      } catch (err) {
        triggerToast(
          err instanceof Error ? err.message : "Failed to mark synced",
          "error"
        );
      }
    },

    copyDriftSyncPrompt: async (nodeIds) => {
      try {
        const prompt = await commands.exportDriftSyncPrompt(nodeIds);
        await navigator.clipboard.writeText(prompt);
        triggerToast("Copied drift sync prompt to clipboard", "success");
      } catch (err) {
        triggerToast(
          err instanceof Error ? err.message : "Failed to export drift sync prompt",
          "error"
        );
      }
    },

    copySelectedContext: async () => {
      const { selectedNodeIds, selectedNodeId } = get();
      const ids =
        selectedNodeIds.length > 0
          ? selectedNodeIds
          : selectedNodeId
          ? [selectedNodeId]
          : [];
      if (ids.length === 0) return;
      try {
        if (ids.length === 1) {
          const markdown = await commands.exportNodeContext(ids[0]);
          await navigator.clipboard.writeText(markdown);
          triggerToast(`Copied scoped context for "${ids[0]}"`, "success");
        } else {
          const markdown = await commands.exportMultiNodeContext(ids);
          await navigator.clipboard.writeText(markdown);
          triggerToast(`Copied slice context for ${ids.length} nodes`, "success");
        }
      } catch (err) {
        triggerToast(
          err instanceof Error ? err.message : "Failed to export context",
          "error"
        );
      }
    },

    addNode: ({ title, kind, summary = "", parentId }) => {
      const { graph, layout, currentParentId, undoStack } = get();
      if (!graph || !layout) return null;
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);

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
        undoStack: nextUndo,
        redoStack: [],
        selectedNodeId: id,
        selectedEdgeId: null,
      });
      scheduleSaveGraph();
      scheduleSaveLayout();
      return newNode;
    },

    updateNode: (id, patch) => {
      const { graph, layout, undoStack } = get();
      if (!graph || !layout) return;
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);
      const nextGraph: Graph = {
        ...graph,
        updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      };
      set({ graph: nextGraph, undoStack: nextUndo, redoStack: [] });
      scheduleSaveGraph();
    },

    deleteNode: (id) => {
      const { graph, layout, currentParentId, selectedNodeId, undoStack } = get();
      if (!graph || !layout) return;
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);

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
        undoStack: nextUndo,
        redoStack: [],
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
      const { graph, layout, undoStack } = get();
      if (!graph || !layout || source === target) return null;

      const duplicate = graph.edges.some(
        (e) => e.source === source && e.target === target
      );
      if (duplicate) return null;

      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);
      const existingIds = new Set(graph.edges.map((e) => e.id));
      const id = slugifyId(`e-${source}-${target}`, existingIds);
      const newEdge: BloxdEdge = { id, source, target, label, kind };

      set({
        graph: {
          ...graph,
          updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          edges: [...graph.edges, newEdge],
        },
        undoStack: nextUndo,
        redoStack: [],
      });
      scheduleSaveGraph();
      return newEdge;
    },

    deleteEdge: (id) => {
      const { graph, layout, selectedEdgeId, undoStack } = get();
      if (!graph || !layout) return;
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);
      set({
        graph: {
          ...graph,
          updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          edges: graph.edges.filter((e) => e.id !== id),
        },
        undoStack: nextUndo,
        redoStack: [],
        selectedEdgeId: selectedEdgeId === id ? null : selectedEdgeId,
      });
      scheduleSaveGraph();
    },

    updateNodeLayout: (id, patch) => {
      const { graph, layout, undoStack } = get();
      if (!graph || !layout) return;
      const current = layout.nodes[id] ?? {
        x: 100,
        y: 100,
        width: 260,
        height: 136,
      };
      if (
        (patch.x === undefined || patch.x === current.x) &&
        (patch.y === undefined || patch.y === current.y) &&
        (patch.width === undefined || patch.width === current.width) &&
        (patch.height === undefined || patch.height === current.height)
      ) {
        return;
      }
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);
      set({
        layout: {
          ...layout,
          nodes: {
            ...layout.nodes,
            [id]: { ...current, ...patch },
          },
        },
        undoStack: nextUndo,
        redoStack: [],
      });
      scheduleSaveLayout();
    },

    updateEdgeLabelOffset: (edgeId, offset) => {
      const { layout } = get();
      if (!layout) return;
      const nextLabels = { ...(layout.edge_labels ?? {}) };
      if (offset === null) {
        delete nextLabels[edgeId];
      } else {
        nextLabels[edgeId] = {
          x: Math.round(offset.x),
          y: Math.round(offset.y),
        };
      }
      set({
        layout: {
          ...layout,
          edge_labels: nextLabels,
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

    autoLayoutCurrentLayer: async (direction) => {
      const { graph, layout, currentParentId, viewMode, layoutDirection, undoStack } =
        get();
      if (!graph || !layout) return;
      const nextUndo = [
        ...undoStack,
        { graph: structuredClone(graph), layout: structuredClone(layout) },
      ].slice(-MAX_UNDO_HISTORY);

      const dir = direction ?? layoutDirection;
      const nextNodesLayout = { ...layout.nodes };

      if (viewMode === "nested") {
        const layerNodes = graph.nodes.filter(
          (n) => (n.parent_id ?? null) === currentParentId
        );
        if (layerNodes.length === 0) return;

        // Build direct + rolled-up edges with accurate aggregated labels so ELK reserves space for every pill
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

        const directPairSet = new Set(
          graph.edges
            .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
            .map((e) => `${e.source}->${e.target}`)
        );
        const rolledBuckets = new Map<
          string,
          { source: string; target: string; labels: string[]; kind: EdgeKind }
        >();

        for (const e of graph.edges) {
          const src = findVisibleAncestor(e.source);
          const dst = findVisibleAncestor(e.target);
          if (!src || !dst || src === dst) continue;
          const pk = `${src}->${dst}`;
          if (directPairSet.has(pk)) continue;
          const entry = rolledBuckets.get(pk) ?? {
            source: src,
            target: dst,
            labels: [],
            kind: e.kind,
          };
          if (e.label) entry.labels.push(e.label);
          rolledBuckets.set(pk, entry);
        }

        const layoutEdges: BloxdEdge[] = [
          ...graph.edges.filter(
            (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
          ),
          ...[...rolledBuckets.entries()].map(([pk, info]) => ({
            id: `virt-${pk}`,
            source: info.source,
            target: info.target,
            label:
              info.labels.length === 1
                ? info.labels[0]
                : `${info.labels.length || 1} links`,
            kind: info.kind,
          })),
        ];

        try {
          const elkResult = await computeElkLayout(
            layerNodes,
            layoutEdges,
            dir,
            nextNodesLayout
          );
          for (const [id, pos] of Object.entries(elkResult.nodePositions)) {
            const prev = nextNodesLayout[id] ?? {
              x: pos.x,
              y: pos.y,
              width: 260,
              height: 136,
            };
            nextNodesLayout[id] = { ...prev, x: pos.x, y: pos.y };
          }
        } catch (err) {
          console.warn("ELK layout failed, falling back to grid:", err);
          const positions = computeFallbackGridLayout(layerNodes, dir);
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
      } else {
        // Unified mode: ELK compound hierarchical layout
        try {
          const elkResult = await computeElkHierarchicalLayout(
            graph.nodes,
            graph.edges,
            dir,
            nextNodesLayout
          );
          for (const [id, pos] of Object.entries(elkResult.nodePositions)) {
            const prev = nextNodesLayout[id] ?? {
              x: pos.x,
              y: pos.y,
              width: 260,
              height: 136,
            };
            nextNodesLayout[id] = { ...prev, x: pos.x, y: pos.y };
          }
        } catch (err) {
          console.warn("ELK hierarchical layout failed, falling back:", err);
          const groupsByParent = new Map<string | null, BloxdNode[]>();
          for (const n of graph.nodes) {
            const key = n.parent_id ?? null;
            const list = groupsByParent.get(key) ?? [];
            list.push(n);
            groupsByParent.set(key, list);
          }
          for (const [parentKey, layerNodes] of groupsByParent.entries()) {
            const positions = computeFallbackGridLayout(
              layerNodes,
              dir,
              parentKey === null ? 50 : 112
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
      }

      // Clear saved manual label overrides so the dynamic collision-free router places every label cleanly
      set({
        layoutDirection: dir,
        layout: {
          ...layout,
          nodes: nextNodesLayout,
          edge_labels: {},
        },
        undoStack: nextUndo,
        redoStack: [],
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
        // Place spacious fallback synchronously, then refine asynchronously with ELK
        const positions = computeFallbackGridLayout(
          layerNodes,
          layoutDirection,
          parentId === null ? 60 : 112
        );
        for (const [id, pos] of Object.entries(positions)) {
          nextNodesLayout[id] = {
            x: pos.x,
            y: pos.y,
            width: 260,
            height: 136,
          };
        }

        computeElkLayout(
          layerNodes,
          graph.edges,
          layoutDirection,
          nextNodesLayout,
          parentId === null ? 60 : 112
        )
          .then((elkResult) => {
            const curLayout = get().layout;
            if (!curLayout) return;
            const refined = { ...curLayout.nodes };
            for (const [id, pos] of Object.entries(elkResult.nodePositions)) {
              const prev = refined[id] ?? { x: pos.x, y: pos.y, width: 260, height: 136 };
              refined[id] = { ...prev, x: pos.x, y: pos.y };
            }
            set({ layout: { ...curLayout, nodes: refined } });
            scheduleSaveLayout();
          })
          .catch(() => {
            // Keep grid fallback silently
          });
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
            width: 260,
            height: 136,
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
