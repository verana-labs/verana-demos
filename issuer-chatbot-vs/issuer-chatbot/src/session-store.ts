import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export enum SessionState {
  WELCOME = "WELCOME",
  COLLECT_ATTRS = "COLLECT_ATTRS",
  ISSUE = "ISSUE",
  DONE = "DONE",
}

export interface Session {
  connectionId: string;
  state: SessionState;
  currentAttributeIndex: number;
  collectedAttributes: Record<string, string>;
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
    // Parse "sqlite:./data/sessions.db" → "./data/sessions.db"
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
        currentAttributeIndex INTEGER NOT NULL DEFAULT 0,
        collectedAttributes TEXT NOT NULL DEFAULT '{}',
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
          currentAttributeIndex: number;
          collectedAttributes: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      connectionId: row.connectionId,
      state: row.state as SessionState,
      currentAttributeIndex: row.currentAttributeIndex,
      collectedAttributes: JSON.parse(row.collectedAttributes),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  createSession(connectionId: string): Session {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions
         (connectionId, state, currentAttributeIndex, collectedAttributes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(connectionId, SessionState.WELCOME, 0, "{}", now, now);

    return {
      connectionId,
      state: SessionState.WELCOME,
      currentAttributeIndex: 0,
      collectedAttributes: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  updateSession(
    connectionId: string,
    updates: Partial<
      Pick<Session, "state" | "currentAttributeIndex" | "collectedAttributes">
    >
  ): void {
    const session = this.getSession(connectionId);
    if (!session) return;

    const newState = updates.state ?? session.state;
    const newIndex =
      updates.currentAttributeIndex ?? session.currentAttributeIndex;
    const newAttrs = updates.collectedAttributes
      ? JSON.stringify(updates.collectedAttributes)
      : JSON.stringify(session.collectedAttributes);

    this.db
      .prepare(
        `UPDATE sessions
         SET state = ?, currentAttributeIndex = ?, collectedAttributes = ?, updatedAt = datetime('now')
         WHERE connectionId = ?`
      )
      .run(newState, newIndex, newAttrs, connectionId);
  }

  resetSession(connectionId: string, toState: SessionState): void {
    this.updateSession(connectionId, {
      state: toState,
      currentAttributeIndex: 0,
      collectedAttributes: {},
    });
  }

  close(): void {
    this.db.close();
  }
}
