export type WebSocketConnectionState = "connecting" | "idle" | "transmitting" | "retiring";
export type WebSocketActivityKind = "response" | "compaction" | "prewarm";

export interface WebSocketConnectionActivity {
  activeRequestId?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  activityKind: WebSocketActivityKind;
}
export type WebSocketConnectionIdentifiers = Pick<WebSocketConnectionActivity, "sessionId" | "threadId" | "turnId">;

export interface WebSocketConnectionView {
  connectionId: string;
  state: WebSocketConnectionState;
  connectedAt: number;
  activeRequestId?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  activityKind?: WebSocketActivityKind;
}

interface ConnectionRecord extends WebSocketConnectionView {
  accountId?: string;
  retire: () => void;
}

export interface WebSocketConnectionHandle {
  update(state: Exclude<WebSocketConnectionState, "retiring">, activity?: WebSocketConnectionActivity): void;
  updateIdentifiers(identifiers: WebSocketConnectionIdentifiers): void;
  setRetire(retire: () => void): void;
  remove(): void;
}

export class WebSocketConnectionRegistry {
  private readonly connections = new Map<string, ConnectionRecord>();

  constructor(private readonly onChange: (connectionId: string) => void = () => undefined) {}

  add(input: { connectionId: string; accountId?: string; connectedAt: number } & WebSocketConnectionIdentifiers): WebSocketConnectionHandle {
    const record: ConnectionRecord = {
      ...input,
      state: "connecting",
      retire: () => undefined,
    };
    this.connections.set(input.connectionId, record);
    this.onChange(input.connectionId);

    return {
      update: (state, activity) => {
        const current = this.connections.get(input.connectionId);
        if (!current || current.state === "retiring") return;
        const next = state === "transmitting" && activity
          ? {
              activeRequestId: activity.activeRequestId,
              sessionId: activity.sessionId ?? current.sessionId,
              threadId: activity.threadId ?? current.threadId,
              turnId: activity.turnId ?? current.turnId,
              activityKind: activity.activityKind,
            }
          : {
              activeRequestId: undefined,
              sessionId: current.sessionId,
              threadId: current.threadId,
              turnId: current.turnId,
              activityKind: undefined,
            };
        if (current.state === state && current.activeRequestId === next.activeRequestId && current.sessionId === next.sessionId && current.threadId === next.threadId && current.turnId === next.turnId && current.activityKind === next.activityKind) return;
        current.state = state;
        Object.assign(current, next);
        this.onChange(input.connectionId);
      },
      updateIdentifiers: (identifiers) => {
        const current = this.connections.get(input.connectionId);
        if (!current || current.state === "retiring") return;
        const next = {
          sessionId: identifiers.sessionId ?? current.sessionId,
          threadId: identifiers.threadId ?? current.threadId,
          turnId: identifiers.turnId ?? current.turnId,
        };
        if (current.sessionId === next.sessionId && current.threadId === next.threadId && current.turnId === next.turnId) return;
        Object.assign(current, next);
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
      .map(({ connectionId, state, connectedAt, activeRequestId, sessionId, threadId, turnId, activityKind }) => ({
        connectionId,
        state,
        connectedAt,
        ...(activeRequestId ? { activeRequestId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(turnId ? { turnId } : {}),
        ...(activityKind ? { activityKind } : {}),
      }));
  }
}
