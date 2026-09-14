import { Router, Request, Response } from "express";
import { Chatbot } from "./chatbot";
import { VsAgentClient } from "./vs-agent-client";
import { PlaygroundSessionStore } from "./playground-sessions";

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

/**
 * `didcomm.presentations.state-updated` — the presentation record plus
 * previousState. The holder's answer arrives here, not as a chat message:
 * the agent verifies the presentation and reports the revealed attributes.
 */
interface PresentationRecord {
  proofExchangeId: string;
  connectionId?: string;
  state: string;
  previousState: string | null;
  verified: boolean;
  claims: { name: string; value: string }[];
  [key: string]: unknown;
}

const CONNECTION_STATE_UPDATED = "didcomm.connections.state-updated";
const MESSAGE_RECEIVED = "didcomm.basic-messages.message-received";
const MENU_PERFORM_RECEIVED = "didcomm.action-menu.perform-received";
const PRESENTATION_STATE_UPDATED = "didcomm.presentations.state-updated";

export function createWebhookRouter(
  chatbot: Chatbot,
  client: VsAgentClient,
  playground: PlaygroundSessionStore
): Router {
  const router = Router();

  // Playground: create a QR session (fresh invitation + pollable session id)
  router.post("/api/invitation", async (_req: Request, res: Response) => {
    try {
      const { url } = await client.createConnectionInvitation();
      const session = playground.createSession();
      res.json({ sessionId: session.sessionId, invitationUrl: url });
    } catch (error) {
      console.error("Failed to create playground invitation:", error);
      res.status(500).json({ error: "Failed to create invitation" });
    }
  });

  // Playground: poll a session for the verification result
  router.get("/api/result/:sessionId", (req: Request, res: Response) => {
    const session = playground.getSession(req.params.sessionId as string);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.status === "verified") {
      res.json({ status: "verified", attributes: session.attributes });
    } else {
      res.json({ status: session.status });
    }
  });

  router.post("/events", async (req: Request, res: Response) => {
    const event = req.body as EventEnvelope;
    try {
      console.log(`Event ${event.type} (${event.id})`);
      await handleEvent(chatbot, playground, event);
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
  playground: PlaygroundSessionStore,
  event: EventEnvelope
): Promise<void> {
  switch (event.type) {
    case CONNECTION_STATE_UPDATED: {
      const record = event.data as unknown as ConnectionRecord;
      if (record.state !== "completed") return;
      const claimed = playground.claimNextPending(record.id);
      if (claimed) {
        console.log(
          `Connection ${record.id} claimed playground session ${claimed.sessionId}`
        );
      }
      await chatbot.onNewConnection(record.id);
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

    case PRESENTATION_STATE_UPDATED: {
      const presentation = event.data as unknown as PresentationRecord;
      // The agent sets `verified` once it has checked the presentation, which
      // is the state the record reaches as `done`.
      if (presentation.state !== "done" || !presentation.connectionId) return;
      if (!presentation.verified) {
        console.warn(
          `Presentation ${presentation.proofExchangeId} did not verify`
        );
        return;
      }
      const claims = toClaimMap(presentation.claims);
      playground.markVerified(presentation.connectionId, claims);
      await chatbot.onProofSubmit(presentation.connectionId, claims);
      return;
    }

    default:
      // Receipts, profile disclosure, credential exchanges and indexer
      // notifications need no action from this chatbot.
      return;
  }
}

function toClaimMap(
  claims: { name: string; value: string }[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const claim of claims ?? []) {
    result[claim.name] = String(claim.value);
  }
  if (Object.keys(result).length === 0) {
    console.warn("The verified presentation revealed no attribute");
  }
  return result;
}
