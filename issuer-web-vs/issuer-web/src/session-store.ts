import crypto from "crypto";

export interface Session {
  sessionId: string;
  credentialExchangeId: string;
  status: "filling" | "waiting" | "issued" | "error";
  claims: Record<string, string>;
  connectionId?: string;
  errorMessage?: string;
  createdAt: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  // Map credentialExchangeId → sessionId for webhook lookups
  private credExIndex = new Map<string, string>();

  createSession(credentialExchangeId: string, claims: Record<string, string>): Session {
    const sessionId = crypto.randomUUID();
    const session: Session = {
      sessionId,
      credentialExchangeId,
      status: "waiting",
      claims,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.credExIndex.set(credentialExchangeId, sessionId);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByCredentialExchangeId(credentialExchangeId: string): Session | undefined {
    const sessionId = this.credExIndex.get(credentialExchangeId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  markIssued(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "issued";
    }
  }

  markError(sessionId: string, errorMessage: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "error";
      session.errorMessage = errorMessage;
    }
  }

  setConnectionId(sessionId: string, connectionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connectionId = connectionId;
    }
  }

  cleanup(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > maxAgeMs) {
        this.credExIndex.delete(session.credentialExchangeId);
        this.sessions.delete(id);
      }
    }
  }
}
