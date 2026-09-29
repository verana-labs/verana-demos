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
 * option. The event names the option in `name`.
 */
interface PerformReceivedData {
  connectionId: string;
  threadId?: string;
  name: string;
  params?: Record<string, string>;
}

/**
 * `didcomm.presentations.state-updated` — the presentation record plus
 * previousState. The holder's answer arrives here, not as a chat message:
 * the agent verifies the presentation and reports the revealed attributes.
 * The record names the connection of the exchange, not the chat connection, so
 * the chatbot correlates on `proofExchangeId`.
 */
interface PresentationRecord {
  proofExchangeId: string;
  connectionId?: string;
  role: string;
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

  // Playground: create a QR session (agent public DID + pollable session id).
  // No v2 route mints a bare connection invitation, so the caller shows the
  // public DID of the agent and the wallet dials that DID itself.
  router.post("/api/invitation", async (_req: Request, res: Response) => {
    try {
      const { did } = await client.getAgent();
      if (!did) {
        res.status(503).json({ error: "The agent has no public DID yet" });
        return;
      }
      const session = playground.createSession();
      res.json({ sessionId: session.sessionId, agentDid: did });
    } catch (error) {
      console.error("Failed to create playground session:", error);
      res.status(500).json({ error: "Failed to create session" });
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

    case PRESENTATION_STATE_UPDATED: {
      const presentation = event.data as unknown as PresentationRecord;
      // The agent sets `verified` once it has checked the presentation, which
      // is the state the record reaches as `done`.
      if (presentation.role !== "verifier" || presentation.state !== "done") {
        return;
      }
      const connectionId = chatbot.takeProofConnection(
        presentation.proofExchangeId
      );
      if (!connectionId) {
        console.warn(
          `No chat connection for proof exchange ${presentation.proofExchangeId}`
        );
        return;
      }
      if (!presentation.verified) {
        console.warn(
          `Presentation ${presentation.proofExchangeId} did not verify`
        );
        return;
      }
      const claims = toClaimMap(presentation.claims);
      playground.markVerified(connectionId, claims);
      await chatbot.onProofSubmit(connectionId, claims);
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
