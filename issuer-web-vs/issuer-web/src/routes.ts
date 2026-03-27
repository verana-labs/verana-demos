import { Router, Request, Response } from "express";
import QRCode from "qrcode";
import { VsAgentClient } from "./vs-agent-client";
import { SchemaInfo } from "./schema-reader";
import { SessionStore } from "./session-store";
import { Config } from "./config";

interface MessageReceivedEvent {
  timestamp?: string;
  message: {
    id?: string;
    type?: string;
    connectionId?: string;
    state?: string;
    threadId?: string;
    [key: string]: unknown;
  };
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
    res.type("html").send(renderPage(config.serviceName, schema));
  });

  // Create OOB invitation + queue credential issuance
  router.post("/api/issue", async (req: Request, res: Response) => {
    try {
      const claims = req.body as Record<string, string>;

      // Validate required attributes
      const missing = schema.attributes
        .filter((a) => a.required && !claims[a.name])
        .map((a) => a.name);
      if (missing.length > 0) {
        res
          .status(400)
          .json({ error: `Missing required fields: ${missing.join(", ")}` });
        return;
      }

      // Create credential-offer invitation (one-time, credential embedded)
      const claimsArray = schema.attributes
        .filter((a) => claims[a.name] !== undefined)
        .map((a) => ({ name: a.name, value: claims[a.name] }));

      const offerResponse = await client.createCredentialOfferInvitation(
        schema.credentialDefinitionId,
        claimsArray
      );
      console.log(
        `Credential offer created: exchangeId=${offerResponse.credentialExchangeId}`
      );

      const session = store.createSession(
        offerResponse.credentialExchangeId,
        claims
      );

      // Use shortUrl for QR (full URL is too large for QR codes)
      const qrUrl = offerResponse.shortUrl || offerResponse.url;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, {
        width: 300,
        margin: 2,
      });

      res.json({
        sessionId: session.sessionId,
        invitationUrl: qrUrl,
        qrDataUrl,
      });
    } catch (error) {
      console.error("Failed to create issuance invitation:", error);
      res.status(500).json({ error: "Failed to create invitation" });
    }
  });

  // Poll for issuance result
  router.get("/api/result/:sessionId", (req: Request, res: Response) => {
    const session = store.getSession(req.params.sessionId as string);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.status === "issued") {
      res.json({ status: "issued", claims: session.claims });
    } else if (session.status === "error") {
      res.json({ status: "error", error: session.errorMessage });
    } else {
      res.json({ status: "waiting" });
    }
  });

  // Webhook: message-received → track credential issuance completion
  router.post(
    "/webhooks/message-received",
    async (req: Request, res: Response) => {
      try {
        const event = req.body as MessageReceivedEvent;
        const msg = event.message;
        const msgType = (msg.type || "").toLowerCase();

        console.log(
          `Webhook: message-received — type=${msgType} id=${msg.id} state=${msg.state || "n/a"}`
        );

        // Only handle credential-reception events
        if (msgType !== "credential-reception") {
          res.status(200).json({ ok: true });
          return;
        }

        const credExId = msg.id || "";
        const state = (msg.state || "").toLowerCase();
        const session = store.getSessionByCredentialExchangeId(credExId);

        if (!session) {
          console.log(
            `No pending session for credentialExchangeId: ${credExId}`
          );
          res.status(200).json({ ok: true });
          return;
        }

        if (msg.connectionId) {
          store.setConnectionId(session.sessionId, msg.connectionId);
        }

        if (state === "done") {
          store.markIssued(session.sessionId);
          console.log(`Credential issued for session ${session.sessionId}`);
        } else if (state === "declined" || state === "abandoned") {
          store.markError(
            session.sessionId,
            `Credential ${state} by holder`
          );
          console.log(
            `Credential ${state} for session ${session.sessionId}`
          );
        }

        res.status(200).json({ ok: true });
      } catch (error) {
        console.error("Error handling message webhook:", error);
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

function renderPage(serviceName: string, schema: SchemaInfo): string {
  const formFields = schema.attributes
    .map((attr) => {
      const req = attr.required ? "required" : "";
      const tag = attr.required ? ' <span class="req">*</span>' : "";
      return `
        <div class="field">
          <label for="f-${attr.name}">${escapeHtml(attr.description)}${tag}</label>
          <input
            type="${attr.type === "number" || attr.type === "integer" ? "number" : "text"}"
            id="f-${attr.name}"
            name="${attr.name}"
            placeholder="${escapeHtml(attr.description)}"
            ${req}
          />
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(serviceName)} — Issuer</title>
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
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
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
      align-items: flex-start;
      justify-content: center;
      padding: 2rem;
      width: 100%;
      max-width: 520px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      width: 100%;
    }
    .card h2 { font-size: 1.2rem; margin-bottom: 0.5rem; color: #333; }
    .card p.sub {
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 1.5rem;
    }
    .field { margin-bottom: 1rem; }
    .field label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #555;
      margin-bottom: 0.3rem;
    }
    .field input {
      width: 100%;
      padding: 0.6rem 0.8rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 0.95rem;
      transition: border-color 0.2s;
    }
    .field input:focus {
      outline: none;
      border-color: #11998e;
      box-shadow: 0 0 0 3px rgba(17,153,142,0.12);
    }
    .req { color: #e74c3c; }
    #qr-container { margin: 1.5rem 0; text-align: center; }
    #qr-container img { border-radius: 8px; }
    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #e0e0e0;
      border-top-color: #11998e;
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
      padding: 0.6rem 0.8rem;
      border-bottom: 1px solid #f0f0f0;
      font-size: 0.9rem;
    }
    .attrs-list li:last-child { border-bottom: none; }
    .attrs-list .attr-name {
      font-weight: 600;
      color: #11998e;
      display: inline-block;
      min-width: 130px;
    }
    .success-icon { font-size: 3rem; margin-bottom: 0.5rem; text-align: center; }
    .error-icon { font-size: 3rem; margin-bottom: 0.5rem; text-align: center; }
    button, .btn {
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      margin-top: 1rem;
      transition: opacity 0.2s;
      width: 100%;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { font-size: 0.85rem; color: #999; margin-top: 0.5rem; text-align: center; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(serviceName)}</h1>
    <p>Credential Issuer</p>
  </header>
  <main>
    <div class="card">
      <!-- STEP 1: Form -->
      <div id="form-view">
        <h2>Issue ${escapeHtml(schema.title)}</h2>
        <p class="sub">Fill in the credential attributes below, then scan the QR code with Hologram Messaging.</p>
        <form id="issue-form">
          ${formFields}
          <button type="submit" id="issue-btn">Generate QR Code</button>
        </form>
      </div>

      <!-- STEP 2: QR code -->
      <div id="qr-view" class="hidden">
        <h2>Scan to receive credential</h2>
        <p class="sub">Ask the holder to scan this QR code with Hologram Messaging.</p>
        <div id="qr-container"><div class="spinner"></div></div>
        <p class="status" id="status-text">Waiting for holder to connect...</p>
        <button type="button" id="cancel-btn">Cancel</button>
      </div>

      <!-- STEP 3: Success -->
      <div id="success-view" class="hidden">
        <div class="success-icon">&#x2705;</div>
        <h2 style="text-align:center">Credential Issued</h2>
        <ul class="attrs-list" id="attrs-list"></ul>
        <button type="button" id="new-btn">Issue Another</button>
      </div>

      <!-- STEP 3b: Error -->
      <div id="error-view" class="hidden">
        <div class="error-icon">&#x274C;</div>
        <h2 style="text-align:center">Issuance Failed</h2>
        <p class="status" id="error-text"></p>
        <button type="button" id="retry-btn">Try Again</button>
      </div>
    </div>
  </main>
  <script>
    const formView = document.getElementById('form-view');
    const qrView = document.getElementById('qr-view');
    const successView = document.getElementById('success-view');
    const errorView = document.getElementById('error-view');
    const issueForm = document.getElementById('issue-form');
    const qrContainer = document.getElementById('qr-container');
    const statusText = document.getElementById('status-text');
    const attrsList = document.getElementById('attrs-list');
    const errorText = document.getElementById('error-text');

    let currentSessionId = null;
    let pollTimer = null;

    function showView(view) {
      [formView, qrView, successView, errorView].forEach(v => v.classList.add('hidden'));
      view.classList.remove('hidden');
    }

    issueForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(issueForm);
      const claims = {};
      for (const [key, value] of formData.entries()) {
        if (value) claims[key] = value.toString();
      }

      showView(qrView);
      qrContainer.innerHTML = '<div class="spinner"></div>';
      statusText.textContent = 'Generating invitation...';

      try {
        const res = await fetch('/api/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(claims),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentSessionId = data.sessionId;
        qrContainer.innerHTML = '<img src="' + data.qrDataUrl + '" alt="QR Code" />';
        statusText.textContent = 'Waiting for holder to scan and connect...';
        startPolling();
      } catch (err) {
        qrContainer.innerHTML = '';
        statusText.textContent = 'Error: ' + err.message;
      }
    });

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (!currentSessionId) return;
        try {
          const res = await fetch('/api/result/' + currentSessionId);
          const data = await res.json();
          if (data.status === 'issued') {
            clearInterval(pollTimer);
            pollTimer = null;
            showSuccess(data.claims);
          } else if (data.status === 'error') {
            clearInterval(pollTimer);
            pollTimer = null;
            showError(data.error);
          }
        } catch (err) {
          console.error('Poll error:', err);
        }
      }, 2000);
    }

    function showSuccess(claims) {
      showView(successView);
      attrsList.innerHTML = '';
      for (const [key, value] of Object.entries(claims)) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="attr-name">' + esc(key) + '</span> ' + esc(value);
        attrsList.appendChild(li);
      }
    }

    function showError(msg) {
      showView(errorView);
      errorText.textContent = msg || 'Unknown error';
    }

    function reset() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      currentSessionId = null;
      showView(formView);
    }

    document.getElementById('cancel-btn').addEventListener('click', reset);
    document.getElementById('new-btn').addEventListener('click', () => {
      issueForm.reset();
      reset();
    });
    document.getElementById('retry-btn').addEventListener('click', reset);

    function esc(text) {
      const d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
