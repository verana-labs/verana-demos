import { Router, Request, Response } from "express";
import { Chatbot } from "./chatbot";

interface ConnectionStateEvent {
  connectionId: string;
  state: string;
  [key: string]: unknown;
}

interface MessageReceivedEvent {
  connectionId: string;
  message: {
    type?: string;
    content?: string;
    text?: string;
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

export function createWebhookRouter(chatbot: Chatbot): Router {
  const router = Router();

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
      const connectionId = event.connectionId;

      console.log(`Webhook: message-received — ${connectionId}`, msg.type);

      const msgType = (msg.type || "").toLowerCase();

      // Handle proof submission
      if (
        msgType.includes("identityproofsubmitmessage") ||
        msgType.includes("proofsubmit") ||
        msg.submittedProofItems
      ) {
        const claims = extractClaims(msg);
        await chatbot.onProofSubmit(connectionId, claims);
      }
      // Handle menu selection
      else if (
        msgType.includes("contextualmenuselectmessage") ||
        msgType.includes("menuselectmessage") ||
        msgType.includes("menuselect") ||
        msg.menuId ||
        msg.selectedOption
      ) {
        const menuId =
          msg.menuId || msg.selectedOption || msg.content || msg.text || "";
        await chatbot.onMenuSelect(connectionId, menuId);
      }
      // Handle text message
      else {
        const text = msg.content || msg.text || "";
        if (text) {
          await chatbot.onTextMessage(connectionId, text);
        }
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
  // Try to extract claims from submittedProofItems
  if (msg.submittedProofItems && msg.submittedProofItems.length > 0) {
    const allClaims: Record<string, string> = {};
    for (const item of msg.submittedProofItems) {
      if (item.claims) {
        Object.assign(allClaims, item.claims);
      }
    }
    return allClaims;
  }

  // Fallback: try claims directly on message
  if (msg.claims) {
    return msg.claims;
  }

  console.warn("No claims found in proof submission message");
  return {};
}
