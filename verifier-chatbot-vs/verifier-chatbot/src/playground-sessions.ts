import { randomUUID } from "crypto";

export type PlaygroundStatus = "pending" | "connected" | "verified";

export interface PlaygroundSession {
  sessionId: string;
  status: PlaygroundStatus;
  connectionId?: string;
  attributes: Record<string, string>;
  createdAt: number;
}

const SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory correlation between playground QR sessions and DIDComm
 * connections, so the playground page can show the verified attributes.
 *
 * The VS-Agent connection-invitation API returns only the invitation URL
 * (no out-of-band record id), while connection events carry the OOB record
 * id — so an exact QR-to-connection mapping is not possible from here.
 * Instead, a completed connection claims the oldest pending playground
 * session still inside the TTL window (FIFO). Demo-grade: two visitors
 * generating QR codes at the same moment could in theory cross-claim.
 */
export class PlaygroundSessionStore {
  private sessions = new Map<string, PlaygroundSession>();
  private byConnection = new Map<string, string>();

  createSession(): PlaygroundSession {
    this.cleanup();
    const session: PlaygroundSession = {
      sessionId: randomUUID(),
      status: "pending",
      attributes: {},
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): PlaygroundSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Attach a newly completed connection to the oldest pending session.
   * Idempotent per connection: repeated events return the same session.
   */
  claimNextPending(connectionId: string): PlaygroundSession | undefined {
    const existing = this.byConnection.get(connectionId);
    if (existing) return this.sessions.get(existing);

    this.cleanup();
    const pending = [...this.sessions.values()]
      .filter((s) => s.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!pending) return undefined;

    pending.status = "connected";
    pending.connectionId = connectionId;
    this.byConnection.set(connectionId, pending.sessionId);
    return pending;
  }

  markVerified(
    connectionId: string,
    attributes: Record<string, string>
  ): PlaygroundSession | undefined {
    const sessionId = this.byConnection.get(connectionId);
    if (!sessionId) return undefined;
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.status = "verified";
    session.attributes = attributes;
    return session;
  }

  private cleanup(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [sessionId, session] of this.sessions) {
      if (session.createdAt < cutoff) {
        if (session.connectionId) {
          this.byConnection.delete(session.connectionId);
        }
        this.sessions.delete(sessionId);
      }
    }
  }
}
