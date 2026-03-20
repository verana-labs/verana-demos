import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export enum SessionState {
  WELCOME = "WELCOME",
  REQUEST_PROOF = "REQUEST_PROOF",
  SHOW_RESULT = "SHOW_RESULT",
  DONE = "DONE",
}

export interface Session {
  connectionId: string;
  state: SessionState;
  receivedAttributes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(databaseUrl: string) {
    const dbPath = this.resolvePath(databaseUrl);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private resolvePath(databaseUrl: string): string {
    if (databaseUrl.startsWith("sqlite:")) {
      return databaseUrl.slice("sqlite:".length);
    }
    return databaseUrl;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        connectionId TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'WELCOME',
        receivedAttributes TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  getSession(connectionId: string): Session | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE connectionId = ?")
      .get(connectionId) as
      | {
          connectionId: string;
          state: string;
          receivedAttributes: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      connectionId: row.connectionId,
      state: row.state as SessionState,
      receivedAttributes: JSON.parse(row.receivedAttributes),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  createSession(connectionId: string): Session {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions
         (connectionId, state, receivedAttributes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(connectionId, SessionState.WELCOME, "{}", now, now);

    return {
      connectionId,
      state: SessionState.WELCOME,
      receivedAttributes: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  updateSession(
    connectionId: string,
    updates: Partial<Pick<Session, "state" | "receivedAttributes">>
  ): void {
    const session = this.getSession(connectionId);
    if (!session) return;

    const newState = updates.state ?? session.state;
    const newAttrs = updates.receivedAttributes
      ? JSON.stringify(updates.receivedAttributes)
      : JSON.stringify(session.receivedAttributes);

    this.db
      .prepare(
        `UPDATE sessions
         SET state = ?, receivedAttributes = ?, updatedAt = datetime('now')
         WHERE connectionId = ?`
      )
      .run(newState, newAttrs, connectionId);
  }

  resetSession(connectionId: string, toState: SessionState): void {
    this.updateSession(connectionId, {
      state: toState,
      receivedAttributes: {},
    });
  }

  close(): void {
    this.db.close();
  }
}
