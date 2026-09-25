export const LIST_MCP_SERVERS_CHANNEL = "mcp:list" as const;
export const SAVE_MCP_SERVER_CHANNEL = "mcp:save" as const;
export const REMOVE_MCP_SERVER_CHANNEL = "mcp:remove" as const;

export type PineMcpScope = "project" | "global";

export interface PineMcpServer {
  name: string;
  scope: PineMcpScope;
  definition: Record<string, unknown>;
}

export interface PineMcpCatalog {
  servers: PineMcpServer[];
  paths: Record<PineMcpScope, string>;
  status?: {
    servers: ReadonlyArray<{
      name: string;
      status: string;
      toolCount: number;
      resourceCount?: number;
    }>;
    connectedCount: number;
    totalTools: number;
  };
}

export interface PineMcpRequest {
  projectId: string;
}

export interface PineMcpMutation extends PineMcpRequest {
  scope: PineMcpScope;
  name: string;
}

export interface PineMcpSaveRequest extends PineMcpMutation {
  previousName?: string;
  definition: Record<string, unknown>;
}
