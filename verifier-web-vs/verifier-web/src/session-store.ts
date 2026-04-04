import crypto from "crypto";

export interface Session {
  sessionId: string;
  proofExchangeId: string;
  status: "pending" | "verified";
  attributes: Record<string, string>;
  createdAt: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  // Map proofExchangeId → sessionId for webhook lookups
  private proofExIndex = new Map<string, string>();

  createSession(proofExchangeId: string): Session {
    const sessionId = crypto.randomUUID();
    const session: Session = {
      sessionId,
      proofExchangeId,
      status: "pending",
      attributes: {},
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.proofExIndex.set(proofExchangeId, sessionId);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByProofExchangeId(proofExchangeId: string): Session | undefined {
    const sessionId = this.proofExIndex.get(proofExchangeId);
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
        this.proofExIndex.delete(session.proofExchangeId);
        this.sessions.delete(id);
      }
    }
  }
}
