import { Router, Request, Response } from "express";
import { Chatbot } from "./chatbot";
import { VsAgentClient } from "./vs-agent-client";
import { PlaygroundSessionStore } from "./playground-sessions";

interface ConnectionStateEvent {
  connectionId: string;
  state: string;
  [key: string]: unknown;
}

interface MessageReceivedEvent {
  timestamp?: string;
  message: {
    id?: string;
    connectionId: string;
    type?: string;
    content?: string;
    text?: string;
    selectionId?: string;
    menuId?: string;
    selectedOption?: string;
    claims?: Record<string, string>;
    submittedProofItems?: Array<{
      claims?: Record<string, string>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

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

  router.post(
    "/connection-state-updated",
    async (req: Request, res: Response) => {
      try {
        const event = req.body as ConnectionStateEvent;
        console.log(
          `Webhook: connection-state-updated — ${event.connectionId} → ${event.state}`
        );

        if (
          event.state === "COMPLETED" ||
          event.state === "completed" ||
          event.state === "active"
        ) {
          const claimed = playground.claimNextPending(event.connectionId);
          if (claimed) {
            console.log(
              `Connection ${event.connectionId} claimed playground session ${claimed.sessionId}`
            );
          }
          await chatbot.onNewConnection(event.connectionId);
        }

        res.status(200).json({ ok: true });
      } catch (error) {
        console.error("Error handling connection event:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post("/message-received", async (req: Request, res: Response) => {
    try {
      const event = req.body as MessageReceivedEvent;
      const msg = event.message;
      const connectionId = msg.connectionId;
      const msgType = (msg.type || "").toLowerCase();
      const messageId = msg.id;

      console.log(`Webhook: message-received — ${connectionId} type=${msgType} id=${messageId}`);

      // Ignore system messages (profile auto-disclosure, receipts, etc.)
      if (msgType === "profile" || msgType === "receipts") {
        res.status(200).json({ ok: true });
        return;
      }

      // Send received + viewed indicators for all user messages
      if (messageId && connectionId) {
        chatbot.sendReceipts(connectionId, messageId).catch((err: unknown) =>
          console.error("Failed to send receipts:", err)
        );
      }

      // Handle proof submission
      if (
        msgType === "identity-proof-submit" ||
        msgType === "identity-proof-result" ||
        msg.submittedProofItems
      ) {
        const claims = extractClaims(msg);
        playground.markVerified(connectionId, claims);
        await chatbot.onProofSubmit(connectionId, claims);
      }
      // Handle menu selection
      else if (
        msgType === "contextual-menu-select" ||
        msgType === "menu-select" ||
        msg.selectionId ||
        msg.menuId ||
        msg.selectedOption
      ) {
        const menuId =
          msg.selectionId || msg.menuId || msg.selectedOption || msg.content || msg.text || "";
        await chatbot.onMenuSelect(connectionId, menuId);
      }
      // Handle text message
      else if (msgType === "text") {
        const text = msg.content || msg.text || "";
        if (text) {
          await chatbot.onTextMessage(connectionId, text);
        }
      } else {
        console.log(`Ignoring unhandled message type: ${msgType}`);
      }

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("Error handling message event:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  return router;
}

function extractClaims(
  msg: MessageReceivedEvent["message"]
): Record<string, string> {
  const raw: Record<string, unknown> = {};

  // Try to extract claims from submittedProofItems
  if (msg.submittedProofItems && msg.submittedProofItems.length > 0) {
    for (const item of msg.submittedProofItems) {
      if (item.claims) {
        Object.assign(raw, item.claims);
      }
    }
  } else if (msg.claims) {
    // Fallback: try claims directly on message
    Object.assign(raw, msg.claims);
  } else {
    console.warn("No claims found in proof submission message");
    return {};
  }

  // Unwrap object values (e.g. {value: "John"} → "John")
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val && typeof val === "object" && "value" in val) {
      result[key] = String((val as { value: unknown }).value);
    } else {
      result[key] = String(val);
    }
  }
  return result;
}
