import { invoke } from "@tauri-apps/api/core";

export type NodeKind = "system" | "service" | "module" | "flow_step" | "task" | "note";
export type Status = "planned" | "in_progress" | "blocked" | "done";
export type EdgeKind = "data_flow" | "dependency" | "sequence" | "triggers";

export interface BloxdNode {
  id: string;
  title: string;
  kind: NodeKind;
  parent_id: string | null;
  status: Status;
  summary: string;
  linked_files: string[];
  spec_file: string | null;
}

export interface BloxdEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
  kind: EdgeKind;
}

export interface Graph {
  version: number;
  project: string;
  updated_at: string;
  nodes: BloxdNode[];
  edges: BloxdEdge[];
}

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string | null;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Layout {
  version: number;
  nodes: Record<string, NodeLayout>;
  viewports: Record<string, Viewport>;
}

export interface ProjectSnapshot {
  project_path: string;
  graph: Graph;
  layout: Layout;
}

export const commands = {
  async getInitialProject(): Promise<string | null> {
    return invoke<string | null>("get_initial_project");
  },
  async openProject(path: string): Promise<ProjectSnapshot> {
    return invoke<ProjectSnapshot>("open_project", { path });
  },
  async saveGraph(graph: Graph): Promise<void> {
    return invoke<void>("save_graph", { graph });
  },
  async saveLayout(layout: Layout): Promise<void> {
    return invoke<void>("save_layout", { layout });
  },
  async readNodeSpec(nodeId: string): Promise<string> {
    return invoke<string>("read_node_spec", { nodeId });
  },
  async writeNodeSpec(nodeId: string, content: string): Promise<void> {
    return invoke<void>("write_node_spec", { nodeId, content });
  },
  async exportNodeContext(nodeId: string): Promise<string> {
    return invoke<string>("export_node_context", { nodeId });
  },
};
