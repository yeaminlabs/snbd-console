import type { WebSocket } from 'ws';

export interface PendingRpc {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AgentConn {
  socket: WebSocket;
  serverId: string;
  terminals: Map<string, WebSocket>;
  pending: Map<string, PendingRpc>;
  lastStored: number;
}

// connected agents by server id (one live connection per server)
export const agents = new Map<string, AgentConn>();
