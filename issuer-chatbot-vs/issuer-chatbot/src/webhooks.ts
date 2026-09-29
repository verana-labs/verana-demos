import { Router, Request, Response } from "express";
import { Chatbot } from "./chatbot";

/**
 * Events API envelope. The agent delivers every event as one POST to
 * EVENTS_WEBHOOK_URL. See the Events section of the VS Agent API document.
 */
interface EventEnvelope<T = Record<string, unknown>> {
  id: string;
  type: string;
  timestamp: string;
  data: T;
}

/** `didcomm.connections.state-updated` — the connection record plus previousState. */
interface ConnectionRecord {
  id: string;
  state: string;
  previousState: string | null;
  [key: string]: unknown;
}

/** `didcomm.basic-messages.message-received` — an inbound text message. */
interface BasicMessageRecord {
  id: string;
  connectionId: string;
  role: string;
  content: string;
  [key: string]: unknown;
}

/**
 * `didcomm.action-menu.perform-received` — the holder picked a contextual menu
 * option. The event names the option in `name`.
 */
interface PerformReceivedData {
  connectionId: string;
  threadId?: string;
  name: string;
  params?: Record<string, string>;
}

/**
 * `didcomm.credential-exchanges.state-updated` — the credential exchange record
 * plus previousState. The record carries the connection of the exchange, not the
 * chat connection, so the chatbot correlates on `credentialExchangeId`.
 */
interface CredentialExchangeRecord {
  credentialExchangeId: string;
  role: string;
  state: string;
  previousState: string | null;
  [key: string]: unknown;
}

const CONNECTION_STATE_UPDATED = "didcomm.connections.state-updated";
const MESSAGE_RECEIVED = "didcomm.basic-messages.message-received";
const MENU_PERFORM_RECEIVED = "didcomm.action-menu.perform-received";
const CREDENTIAL_EXCHANGE_STATE_UPDATED =
  "didcomm.credential-exchanges.state-updated";

export function createWebhookRouter(chatbot: Chatbot): Router {
  const router = Router();

  router.post("/events", async (req: Request, res: Response) => {
    const event = req.body as EventEnvelope;
    try {
      console.log(`Event ${event.type} (${event.id})`);
      await handleEvent(chatbot, event);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error(`Error handling event ${event?.type}:`, error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  return router;
}

async function handleEvent(
  chatbot: Chatbot,
  event: EventEnvelope
): Promise<void> {
  switch (event.type) {
    case CONNECTION_STATE_UPDATED: {
      const record = event.data as unknown as ConnectionRecord;
      if (record.state === "completed") {
        await chatbot.onNewConnection(record.id);
      }
      return;
    }

    case MESSAGE_RECEIVED: {
      // The event carries no DIDComm message id, so the chatbot cannot
      // acknowledge the message with a receipt.
      const message = event.data as unknown as BasicMessageRecord;
      if (message.content) {
        await chatbot.onTextMessage(message.connectionId, message.content);
      }
      return;
    }

    case MENU_PERFORM_RECEIVED: {
      const performed = event.data as unknown as PerformReceivedData;
      const menuId = performed.name ?? "";
      if (menuId) {
        await chatbot.onMenuSelect(performed.connectionId, menuId);
      }
      return;
    }

    case CREDENTIAL_EXCHANGE_STATE_UPDATED: {
      const record = event.data as unknown as CredentialExchangeRecord;
      if (record.role !== "issuer" || record.state !== "done") return;
      await chatbot.onCredentialIssued(record.credentialExchangeId);
      return;
    }

    default:
      // Receipts, profile disclosure, presentations and indexer notifications
      // need no action from this chatbot.
      return;
  }
}
