import crypto from "crypto";

export interface Session {
  sessionId: string;
  invitationId: string;
  status: "pending" | "verified";
  attributes: Record<string, string>;
  createdAt: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  // Map invitationId → sessionId for webhook lookups
  private invitationIndex = new Map<string, string>();

  createSession(invitationId: string): Session {
    const sessionId = crypto.randomUUID();
    const session: Session = {
      sessionId,
      invitationId,
      status: "pending",
      attributes: {},
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.invitationIndex.set(invitationId, sessionId);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByInvitationId(invitationId: string): Session | undefined {
    const sessionId = this.invitationIndex.get(invitationId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  markVerified(
    sessionId: string,
    attributes: Record<string, string>
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "verified";
      session.attributes = attributes;
    }
  }

  cleanup(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > maxAgeMs) {
        this.invitationIndex.delete(session.invitationId);
        this.sessions.delete(id);
      }
    }
  }
}
