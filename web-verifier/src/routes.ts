import { Router, Request, Response } from "express";
import QRCode from "qrcode";
import { VsAgentClient } from "./vs-agent-client";
import { SchemaInfo } from "./schema-reader";
import { SessionStore } from "./session-store";
import { Config } from "./config";

interface ProofReceivedEvent {
  invitationId?: string;
  connectionId?: string;
  claims?: Record<string, string>;
  submittedProofItems?: Array<{
    claims?: Record<string, string>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export function createRoutes(
  client: VsAgentClient,
  schema: SchemaInfo,
  store: SessionStore,
  config: Config
): Router {
  const router = Router();

  // Serve the single-page frontend
  router.get("/", (_req: Request, res: Response) => {
    res.type("html").send(renderPage(config.serviceName, schema.title));
  });

  // Create a new OOB presentation request invitation
  router.post("/api/invitation", async (_req: Request, res: Response) => {
    try {
      const attributeNames = schema.attributes.map((a) => a.name);

      const oobResponse = await client.createOobProofRequest({
        credentialDefinitionId: schema.credentialDefinitionId,
        schemaId: schema.schemaId,
        attributes: attributeNames,
      });

      const session = store.createSession(oobResponse.invitationId);

      // Generate QR code as data URL
      const qrDataUrl = await QRCode.toDataURL(oobResponse.invitationUrl, {
        width: 300,
        margin: 2,
      });

      res.json({
        sessionId: session.sessionId,
        invitationUrl: oobResponse.invitationUrl,
        qrDataUrl,
      });
    } catch (error) {
      console.error("Failed to create invitation:", error);
      res.status(500).json({ error: "Failed to create invitation" });
    }
  });

  // Poll for presentation result
  router.get("/api/result/:sessionId", (req: Request, res: Response) => {
    const session = store.getSession(req.params.sessionId as string);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.status === "verified") {
      res.json({ status: "verified", attributes: session.attributes });
    } else {
      res.json({ status: "pending" });
    }
  });

  // Webhook: proof presentation received
  router.post(
    "/webhooks/proof-received",
    (req: Request, res: Response) => {
      try {
        const event = req.body as ProofReceivedEvent;
        console.log("Webhook: proof-received", JSON.stringify(event).slice(0, 200));

        const invitationId = event.invitationId || event.connectionId || "";
        const session = store.getSessionByInvitationId(invitationId);

        if (!session) {
          // Try to find by iterating (fallback for different webhook payloads)
          console.warn(
            `No session found for invitationId: ${invitationId}`
          );
          res.status(200).json({ ok: true });
          return;
        }

        const claims = extractClaims(event);
        store.markVerified(session.sessionId, claims);
        console.log(
          `Session ${session.sessionId} verified with claims:`,
          claims
        );

        res.status(200).json({ ok: true });
      } catch (error) {
        console.error("Error handling proof webhook:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Health check
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Periodic cleanup of old sessions (every 5 minutes)
  setInterval(() => store.cleanup(), 5 * 60 * 1000);

  return router;
}

function extractClaims(event: ProofReceivedEvent): Record<string, string> {
  if (event.submittedProofItems && event.submittedProofItems.length > 0) {
    const allClaims: Record<string, string> = {};
    for (const item of event.submittedProofItems) {
      if (item.claims) {
        Object.assign(allClaims, item.claims);
      }
    }
    return allClaims;
  }
  if (event.claims) {
    return event.claims;
  }
  return {};
}

function renderPage(serviceName: string, schemaTitle: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serviceName} — Verifier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #1a1a2e;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    header {
      width: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1.5rem 2rem;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    header p { font-size: 0.9rem; opacity: 0.85; margin-top: 0.3rem; }
    main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      width: 100%;
      max-width: 500px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      text-align: center;
      width: 100%;
    }
    .card h2 { font-size: 1.2rem; margin-bottom: 1rem; color: #333; }
    .card p.instructions {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    #qr-container { margin: 1rem 0; }
    #qr-container img { border-radius: 8px; }
    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #e0e0e0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 1rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .attrs-list {
      text-align: left;
      margin: 1rem 0;
      list-style: none;
    }
    .attrs-list li {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #f0f0f0;
      font-size: 0.95rem;
    }
    .attrs-list li:last-child { border-bottom: none; }
    .attrs-list .attr-name {
      font-weight: 600;
      color: #667eea;
      display: inline-block;
      min-width: 140px;
    }
    .success-icon {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      margin-top: 1rem;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { font-size: 0.85rem; color: #999; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <header>
    <h1>${serviceName}</h1>
    <p>Credential Verifier</p>
  </header>
  <main>
    <div class="card">
      <div id="scan-view">
        <h2>Verify your ${schemaTitle}</h2>
        <p class="instructions">
          Scan the QR code below with Hologram Messaging to present your credential.
        </p>
        <div id="qr-container"><div class="spinner"></div></div>
        <p class="status" id="status-text">Generating invitation...</p>
      </div>
      <div id="result-view" style="display:none">
        <div class="success-icon">&#x2705;</div>
        <h2>Credential Verified</h2>
        <ul class="attrs-list" id="attrs-list"></ul>
        <button id="start-over-btn">Start Over</button>
      </div>
    </div>
  </main>
  <script>
    const scanView = document.getElementById('scan-view');
    const resultView = document.getElementById('result-view');
    const qrContainer = document.getElementById('qr-container');
    const statusText = document.getElementById('status-text');
    const attrsList = document.getElementById('attrs-list');
    const startOverBtn = document.getElementById('start-over-btn');

    let currentSessionId = null;
    let pollTimer = null;

    async function createInvitation() {
      scanView.style.display = '';
      resultView.style.display = 'none';
      qrContainer.innerHTML = '<div class="spinner"></div>';
      statusText.textContent = 'Generating invitation...';

      try {
        const res = await fetch('/api/invitation', { method: 'POST' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentSessionId = data.sessionId;
        qrContainer.innerHTML = '<img src="' + data.qrDataUrl + '" alt="QR Code" />';
        statusText.textContent = 'Waiting for credential presentation...';
        startPolling();
      } catch (err) {
        qrContainer.innerHTML = '';
        statusText.textContent = 'Error: ' + err.message;
      }
    }

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (!currentSessionId) return;
        try {
          const res = await fetch('/api/result/' + currentSessionId);
          const data = await res.json();
          if (data.status === 'verified') {
            clearInterval(pollTimer);
            pollTimer = null;
            showResult(data.attributes);
          }
        } catch (err) {
          console.error('Poll error:', err);
        }
      }, 2000);
    }

    function showResult(attributes) {
      scanView.style.display = 'none';
      resultView.style.display = '';
      attrsList.innerHTML = '';
      for (const [key, value] of Object.entries(attributes)) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="attr-name">' + escapeHtml(key) + '</span> ' + escapeHtml(value);
        attrsList.appendChild(li);
      }
    }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }

    startOverBtn.addEventListener('click', () => {
      currentSessionId = null;
      createInvitation();
    });

    createInvitation();
  </script>
</body>
</html>`;
}
