import { randomUUID } from "crypto";

export type PlaygroundStatus = "pending" | "connected" | "verified";

export interface PlaygroundSession {
  sessionId: string;
  /** The invitation record behind the QR code of this session. */
  invitationId: string;
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
 * Each session owns one single-use invitation. The agent names that invitation
 * on the connection it produces (`invitationId`), and on the acceptance of a
 * connection that the wallet held already. Both lead to the same session, so
 * two visitors that scan at the same moment never cross-claim.
 */
export class PlaygroundSessionStore {
  private sessions = new Map<string, PlaygroundSession>();
  private byInvitation = new Map<string, string>();
  private byConnection = new Map<string, string>();

  createSession(invitationId: string): PlaygroundSession {
    this.cleanup();
    const session: PlaygroundSession = {
      sessionId: randomUUID(),
      invitationId,
      status: "pending",
      attributes: {},
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    this.byInvitation.set(invitationId, session.sessionId);
    return session;
  }

  getSession(sessionId: string): PlaygroundSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Attach a connection to the session of the invitation it came from.
   * Idempotent: the connection event and the invitation event both call it.
   * A connection without a session of this store (a wallet that dialled the
   * public DID, for example) returns undefined.
   */
  claimByInvitation(
    invitationId: string,
    connectionId: string
  ): PlaygroundSession | undefined {
    const sessionId = this.byInvitation.get(invitationId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return undefined;

    if (session.status === "pending") session.status = "connected";
    // A previous session of a reused connection no longer receives its result.
    session.connectionId = connectionId;
    this.byConnection.set(connectionId, session.sessionId);
    return session;
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
        this.byInvitation.delete(session.invitationId);
        if (
          session.connectionId &&
          this.byConnection.get(session.connectionId) === sessionId
        ) {
          this.byConnection.delete(session.connectionId);
        }
        this.sessions.delete(sessionId);
      }
    }
  }
}
