export type WebSocketConnectionState = "connecting" | "idle" | "transmitting" | "retiring";

export interface WebSocketConnectionView {
  connectionId: string;
  state: WebSocketConnectionState;
  connectedAt: number;
  activeRequestId?: string;
}

interface ConnectionRecord extends WebSocketConnectionView {
  accountId?: string;
  retire: () => void;
}

export interface WebSocketConnectionHandle {
  update(state: Exclude<WebSocketConnectionState, "retiring">, activeRequestId?: string): void;
  setRetire(retire: () => void): void;
  remove(): void;
}

export class WebSocketConnectionRegistry {
  private readonly connections = new Map<string, ConnectionRecord>();

  constructor(private readonly onChange: (connectionId: string) => void = () => undefined) {}

  add(input: { connectionId: string; accountId?: string; connectedAt: number }): WebSocketConnectionHandle {
    const record: ConnectionRecord = {
      ...input,
      state: "connecting",
      retire: () => undefined,
    };
    this.connections.set(input.connectionId, record);
    this.onChange(input.connectionId);

    return {
      update: (state, activeRequestId) => {
        const current = this.connections.get(input.connectionId);
        if (!current || current.state === "retiring") return;
        if (current.state === state && current.activeRequestId === activeRequestId) return;
        current.state = state;
        current.activeRequestId = activeRequestId;
        this.onChange(input.connectionId);
      },
      setRetire: (retire) => {
        const current = this.connections.get(input.connectionId);
        if (!current) return;
        current.retire = retire;
        if (current.state === "retiring") retire();
      },
      remove: () => {
        if (!this.connections.delete(input.connectionId)) return;
        this.onChange(input.connectionId);
      },
    };
  }

  retireAccount(accountId: string): void {
    for (const connection of this.connections.values()) {
      if (connection.accountId !== accountId || connection.state === "retiring") continue;
      connection.state = "retiring";
      this.onChange(connection.connectionId);
      connection.retire();
    }
  }

  list(): WebSocketConnectionView[] {
    return [...this.connections.values()]
      .sort((left, right) => right.connectedAt - left.connectedAt)
      .map(({ connectionId, state, connectedAt, activeRequestId }) => ({
        connectionId,
        state,
        connectedAt,
        ...(activeRequestId ? { activeRequestId } : {}),
      }));
  }
}
