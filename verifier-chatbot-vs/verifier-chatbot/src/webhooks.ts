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
  /** The invitation record the connection came from, or null. */
  invitationId: string | null;
  [key: string]: unknown;
}

/**
 * `didcomm.invitations.state-updated` — the invitation record plus
 * previousState. Each acceptance names the connection it produced, or the
 * connection the wallet held already (`reused`).
 */
interface InvitationRecord {
  id: string;
  state: string;
  previousState: string | null;
  acceptances: { connectionId: string; reused: boolean; acceptedAt: string }[];
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
const INVITATION_STATE_UPDATED = "didcomm.invitations.state-updated";

export function createWebhookRouter(
  chatbot: Chatbot,
  client: VsAgentClient,
  playground: PlaygroundSessionStore
): Router {
  const router = Router();

  // Playground: create a QR session. The session owns a single-use connection
  // invitation; the QR code carries its short URL, and the page polls the
  // session id for the verified attributes.
  router.post("/api/invitation", async (_req: Request, res: Response) => {
    try {
      const invitation = await client.createInvitation();
      const session = playground.createSession(invitation.id);
      res.json({
        sessionId: session.sessionId,
        invitationUrl: invitation.shortUrl,
      });
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
      if (record.invitationId) {
        claimSession(playground, record.invitationId, record.id);
      }
      await chatbot.onNewConnection(record.id);
      return;
    }

    case INVITATION_STATE_UPDATED: {
      // A new connection also reports itself above, so only a reused one
      // needs the conversation started here.
      const invitation = event.data as unknown as InvitationRecord;
      const acceptance = invitation.acceptances?.at(-1);
      if (!acceptance) return;
      claimSession(playground, invitation.id, acceptance.connectionId);
      if (acceptance.reused) {
        console.log(
          `Connection ${acceptance.connectionId} reused for invitation ${invitation.id}`
        );
        await chatbot.onNewConnection(acceptance.connectionId);
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

function claimSession(
  playground: PlaygroundSessionStore,
  invitationId: string,
  connectionId: string
): void {
  const claimed = playground.claimByInvitation(invitationId, connectionId);
  if (claimed) {
    console.log(
      `Connection ${connectionId} claimed playground session ${claimed.sessionId}`
    );
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
