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
  constraints?: string[];
  synced_commit?: string | null;
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
  last_synced_commit?: string | null;
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

export interface LabelOffset {
  x: number;
  y: number;
}

export interface Layout {
  version: number;
  nodes: Record<string, NodeLayout>;
  viewports: Record<string, Viewport>;
  edge_labels?: Record<string, LabelOffset>;
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

export interface DriftReport {
  head_commit: string | null;
  is_git_repo: boolean;
  drifted: Record<string, string[]>;
}

export interface ProjectSnapshot {
  project_path: string;
  graph: Graph;
  layout: Layout;
  checklists: Record<string, ChecklistProgress>;
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
  async readNodeSpec(nodeId: string): Promise<StringOrEmpty> {
    return invoke<string>("read_node_spec", { nodeId });
  },
  async writeNodeSpec(nodeId: string, content: string): Promise<void> {
    return invoke<void>("write_node_spec", { nodeId, content });
  },
  async exportNodeContext(nodeId: string): Promise<string> {
    return invoke<string>("export_node_context", { nodeId });
  },
  async exportMultiNodeContext(nodeIds: string[]): Promise<string> {
    return invoke<string>("export_multi_node_context", { nodeIds });
  },
  async checkGitDrift(): Promise<DriftReport> {
    return invoke<DriftReport>("check_git_drift");
  },
  async markNodesSynced(nodeIds: string[]): Promise<string | null> {
    return invoke<string | null>("mark_nodes_synced", { nodeIds });
  },
  async exportDriftSyncPrompt(nodeIds: string[]): Promise<string> {
    return invoke<string>("export_drift_sync_prompt", { nodeIds });
  },
};

type StringOrEmpty = string;
