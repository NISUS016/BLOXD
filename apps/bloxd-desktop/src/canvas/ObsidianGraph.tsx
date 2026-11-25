import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";
import { BloxdNode, NodeKind, Status } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

interface SimNode extends SimulationNodeDatum {
  id: string;
  model: BloxdNode;
  radius: number;
  degree: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  isHierarchy: boolean;
  label?: string | null;
}

type ColorMode = "status" | "kind";

const STATUS_COLORS: Record<Status, string> = {
  planned: "#94a3b8",
  in_progress: "#f59e0b",
  blocked: "#f43f5e",
  done: "#10b981",
};

const KIND_COLORS: Record<NodeKind, string> = {
  system: "#3b82f6",
  service: "#8b5cf6",
  module: "#06b6d4",
  flow_step: "#ec4899",
  task: "#f59e0b",
  note: "#64748b",
};

export function ObsidianGraph() {
  const { graph, selectedNodeId, setSelection, jumpToNode } = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [colorMode, setColorMode] = useState<ColorMode>("status");
  const [showHierarchy, setShowHierarchy] = useState(true);

  // Mutable simulation & camera refs so 60-120fps render loop never re-mounts on hover/pan
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map());
  const cameraRef = useRef({ x: 0, y: 0, k: 1 });
  const hoveredIdRef = useRef<string | null>(null);
  const dragNodeRef = useRef<SimNode | null>(null);
  const isPanningRef = useRef(false);
  const dragMovedRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const colorModeRef = useRef<ColorMode>(colorMode);
  const selectedIdRef = useRef<string | null>(selectedNodeId);

  colorModeRef.current = colorMode;
  selectedIdRef.current = selectedNodeId;

  // Build / reconcile force simulation whenever graph or showHierarchy changes
  useEffect(() => {
    if (!graph) return;

    const prevPos = new Map<string, { x: number; y: number; vx?: number; vy?: number }>();
    for (const n of nodesRef.current) {
      if (n.x !== undefined && n.y !== undefined) {
        prevPos.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
      }
    }

    const degreeMap = new Map<string, number>();
    for (const e of graph.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }
    for (const n of graph.nodes) {
      if (n.parent_id) {
        degreeMap.set(n.parent_id, (degreeMap.get(n.parent_id) ?? 0) + 1);
      }
    }

    const simNodes: SimNode[] = graph.nodes.map((n, idx) => {
      const degree = degreeMap.get(n.id) ?? 0;
      const old = prevPos.get(n.id);
      const angle = (idx / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      return {
        id: n.id,
        model: n,
        degree,
        radius: 7 + Math.min(12, degree * 1.4),
        x: old?.x ?? Math.cos(angle) * 140,
        y: old?.y ?? Math.sin(angle) * 140,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
      };
    });

    const nodeIds = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = [];
    const neighborMap = new Map<string, Set<string>>();
    const addNeighbor = (a: string, b: string) => {
      if (!neighborMap.has(a)) neighborMap.set(a, new Set());
      if (!neighborMap.has(b)) neighborMap.set(b, new Set());
      neighborMap.get(a)!.add(b);
      neighborMap.get(b)!.add(a);
    };

    for (const e of graph.edges) {
      if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
        simLinks.push({
          source: e.source,
          target: e.target,
          isHierarchy: false,
          label: e.label,
        });
        addNeighbor(e.source, e.target);
      }
    }

    if (showHierarchy) {
      for (const n of graph.nodes) {
        if (n.parent_id && nodeIds.has(n.parent_id)) {
          simLinks.push({
            source: n.parent_id,
            target: n.id,
            isHierarchy: true,
          });
          addNeighbor(n.parent_id, n.id);
        }
      }
    }

    nodesRef.current = simNodes;
    linksRef.current = simLinks;
    neighborsRef.current = neighborMap;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => (d.isHierarchy ? 75 : 120))
          .strength((d) => (d.isHierarchy ? 0.55 : 0.35))
      )
      .force("charge", forceManyBody<SimNode>().strength(-260))
      .force("center", forceCenter(0, 0))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => d.radius + 14)
      )
      .alphaDecay(0.03);

    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [graph, showHierarchy]);

  // High-DPI canvas resize + animation render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let width = container.clientWidth;
    let height = container.clientHeight;

    const resize = () => {
      if (!canvas || !container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let rafId = 0;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        const cam = cameraRef.current;
        const hoveredId = hoveredIdRef.current;
        const selectedId = selectedIdRef.current;
        const focusId = hoveredId ?? selectedId;
        const focusNeighbors = focusId ? neighborsRef.current.get(focusId) : null;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, width, height);

        // World transform centered at viewport center
        ctx.translate(width / 2 + cam.x, height / 2 + cam.y);
        ctx.scale(cam.k, cam.k);

        // Draw links
        for (const link of linksRef.current) {
          const s = link.source as SimNode;
          const t = link.target as SimNode;
          if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) {
            continue;
          }

          const isConnectedToFocus =
            focusId !== null && (s.id === focusId || t.id === focusId);

          ctx.save();
          if (focusId && !isConnectedToFocus) {
            ctx.globalAlpha = 0.1;
          } else {
            ctx.globalAlpha = link.isHierarchy ? 0.45 : 0.7;
          }

          if (link.isHierarchy) {
            ctx.setLineDash([4 / cam.k, 4 / cam.k]);
            ctx.strokeStyle = "#475569";
            ctx.lineWidth = 1 / cam.k;
          } else {
            ctx.setLineDash([]);
            ctx.strokeStyle = isConnectedToFocus ? "#60a5fa" : "#64748b";
            ctx.lineWidth = (isConnectedToFocus ? 2 : 1.25) / cam.k;
          }

          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw nodes
        for (const n of nodesRef.current) {
          if (n.x === undefined || n.y === undefined) continue;
          const isFocus = focusId === n.id;
          const isNeighbor = focusNeighbors?.has(n.id) ?? false;
          const dimmed = focusId !== null && !isFocus && !isNeighbor;

          const fill =
            colorModeRef.current === "status"
              ? STATUS_COLORS[n.model.status]
              : KIND_COLORS[n.model.kind];

          ctx.save();
          ctx.globalAlpha = dimmed ? 0.15 : 1;

          // Subtle glow for focused/selected node
          if (isFocus || selectedId === n.id) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius + 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(96, 165, 250, 0.25)";
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = (selectedId === n.id ? 2.5 : 1.2) / cam.k;
          ctx.strokeStyle = selectedId === n.id ? "#f8fafc" : "#0f172a";
          ctx.stroke();

          // Show labels when zoomed in or focused/neighbor
          if (cam.k > 0.7 || isFocus || isNeighbor) {
            const fontSize = Math.max(10, Math.min(13, 12 / Math.sqrt(cam.k)));
            ctx.font = `${isFocus ? "600" : "500"} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = dimmed ? "rgba(226, 232, 240, 0.15)" : "#e2e8f0";
            ctx.fillText(n.model.title, n.x, n.y + n.radius + 5);
          }

          ctx.restore();
        }

        ctx.restore();
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const sx = clientX - rect.left - rect.width / 2 - cam.x;
    const sy = clientY - rect.top - rect.height / 2 - cam.y;
    return { x: sx / cam.k, y: sy / cam.k };
  };

  const hitTestNode = (wx: number, wy: number): SimNode | null => {
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      if (n.x === undefined || n.y === undefined) continue;
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
        return n;
      }
    }
    return null;
  };

  return (
    <div ref={containerRef} className="relative h-full w-full flex-1 bg-slate-950">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        onWheel={(e) => {
          e.preventDefault();
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const cam = cameraRef.current;
          const factor = e.deltaY < 0 ? 1.1 : 0.9;
          const nextK = Math.min(4, Math.max(0.2, cam.k * factor));
          const mx = e.clientX - rect.left - rect.width / 2;
          const my = e.clientY - rect.top - rect.height / 2;
          cam.x = mx - ((mx - cam.x) / cam.k) * nextK;
          cam.y = my - ((my - cam.y) / cam.k) * nextK;
          cam.k = nextK;
        }}
        onPointerDown={(e) => {
          const world = screenToWorld(e.clientX, e.clientY);
          const hit = hitTestNode(world.x, world.y);
          dragMovedRef.current = false;
          lastPointerRef.current = { x: e.clientX, y: e.clientY };

          if (hit) {
            dragNodeRef.current = hit;
            hit.fx = hit.x;
            hit.fy = hit.y;
            simRef.current?.alphaTarget(0.25).restart();
          } else {
            isPanningRef.current = true;
          }
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const dx = e.clientX - lastPointerRef.current.x;
          const dy = e.clientY - lastPointerRef.current.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            dragMovedRef.current = true;
          }
          lastPointerRef.current = { x: e.clientX, y: e.clientY };

          if (dragNodeRef.current) {
            const world = screenToWorld(e.clientX, e.clientY);
            dragNodeRef.current.fx = world.x;
            dragNodeRef.current.fy = world.y;
            return;
          }

          if (isPanningRef.current) {
            cameraRef.current.x += dx;
            cameraRef.current.y += dy;
            return;
          }

          const world = screenToWorld(e.clientX, e.clientY);
          const hit = hitTestNode(world.x, world.y);
          hoveredIdRef.current = hit?.id ?? null;
        }}
        onPointerUp={(e) => {
          if (dragNodeRef.current) {
            const hit = dragNodeRef.current;
            hit.fx = null;
            hit.fy = null;
            simRef.current?.alphaTarget(0);
            dragNodeRef.current = null;
            if (!dragMovedRef.current) {
              setSelection(hit.id, null);
            }
          } else if (isPanningRef.current) {
            isPanningRef.current = false;
            if (!dragMovedRef.current) {
              setSelection(null, null);
            }
          }
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            // ignore if not captured
          }
        }}
        onDoubleClick={(e) => {
          const world = screenToWorld(e.clientX, e.clientY);
          const hit = hitTestNode(world.x, world.y);
          if (hit) {
            jumpToNode(hit.id);
          }
        }}
      />

      {/* Floating Graph Controls */}
      <div className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs shadow-xl backdrop-blur-sm">
        <span className="text-slate-400">Color:</span>
        <button
          type="button"
          onClick={() => setColorMode("status")}
          className={`cursor-pointer rounded px-2 py-0.5 font-medium ${
            colorMode === "status"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Status
        </button>
        <button
          type="button"
          onClick={() => setColorMode("kind")}
          className={`cursor-pointer rounded px-2 py-0.5 font-medium ${
            colorMode === "kind"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Kind
        </button>

        <span className="mx-1 h-3.5 w-px bg-slate-800" />

        <button
          type="button"
          onClick={() => setShowHierarchy((v) => !v)}
          className={`cursor-pointer rounded px-2 py-0.5 font-medium ${
            showHierarchy
              ? "bg-blue-500/15 text-blue-300"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Hierarchy {showHierarchy ? "On" : "Off"}
        </button>

        <button
          type="button"
          onClick={() => {
            cameraRef.current = { x: 0, y: 0, k: 1 };
          }}
          className="cursor-pointer rounded px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
