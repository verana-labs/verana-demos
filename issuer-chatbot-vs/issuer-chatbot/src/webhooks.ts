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
 * option. The plaintext Action Menu `perform` message carries the option id in
 * its `name` field.
 */
interface ExtensionMessageEvent {
  connectionId: string;
  threadId?: string;
  message: { name?: string; [key: string]: unknown };
}

const CONNECTION_STATE_UPDATED = "didcomm.connections.state-updated";
const MESSAGE_RECEIVED = "didcomm.basic-messages.message-received";
const MENU_PERFORM_RECEIVED = "didcomm.action-menu.perform-received";

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
      const message = event.data as unknown as BasicMessageRecord;
      // Tell the holder the message arrived and was read.
      chatbot
        .sendReceipts(message.connectionId, message.id)
        .catch((err: unknown) =>
          console.error("Failed to send receipts:", err)
        );
      if (message.content) {
        await chatbot.onTextMessage(message.connectionId, message.content);
      }
      return;
    }

    case MENU_PERFORM_RECEIVED: {
      const performed = event.data as unknown as ExtensionMessageEvent;
      const menuId = performed.message?.name ?? "";
      if (menuId) {
        await chatbot.onMenuSelect(performed.connectionId, menuId);
      }
      return;
    }

    default:
      // Receipts, profile disclosure, credential exchanges and indexer
      // notifications need no action from this chatbot.
      return;
  }
}
