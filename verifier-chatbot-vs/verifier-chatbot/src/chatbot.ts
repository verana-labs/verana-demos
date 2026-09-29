import { Config } from "./config";
import { VsAgentClient, ContextualMenu } from "./vs-agent-client";
import { SchemaInfo } from "./schema-reader";
import { SessionStore, SessionState } from "./session-store";

export class Chatbot {
  private client: VsAgentClient;
  private store: SessionStore;
  private schema: SchemaInfo;
  private config: Config;

  // The holder opens a second connection for the presentation exchange, and the
  // exchange events name only the exchange. This map gives back the chat
  // connection that asked for the presentation.
  private chatByProofExchange = new Map<string, string>();

  constructor(
    client: VsAgentClient,
    store: SessionStore,
    schema: SchemaInfo,
    config: Config
  ) {
    this.client = client;
    this.store = store;
    this.schema = schema;
    this.config = config;
  }

  private menuTitle(): string {
    return `${this.config.serviceName} Verifier`;
  }

  // The agent refuses a menu that has no option, so every state offers one.
  private menuForState(state: SessionState): ContextualMenu {
    const title = this.menuTitle();
    switch (state) {
      case SessionState.WELCOME:
        return {
          title,
          description: "Ready to verify",
          options: [
            {
              name: "verify",
              title: "Verify my credential",
              description: "Present your credential",
            },
          ],
        };
      case SessionState.REQUEST_PROOF:
        return {
          title,
          description: "Waiting for credential presentation",
          options: [
            {
              name: "abort",
              title: "Cancel",
              description: "Stop the verification",
            },
          ],
        };
      case SessionState.DONE:
        return {
          title,
          description: "Verification complete",
          options: [
            {
              name: "new_presentation",
              title: "New presentation",
              description: "Verify another credential",
            },
          ],
        };
      default:
        return {
          title,
          description: "Welcome",
          options: [
            {
              name: "verify",
              title: "Verify my credential",
              description: "Present your credential",
            },
          ],
        };
    }
  }

  private async sendText(
    connectionId: string,
    text: string,
    state: SessionState
  ): Promise<void> {
    await this.client.sendMessage({
      connectionId,
      content: text,
      contextualMenu: this.menuForState(state),
    });
  }

  private ensureSession(connectionId: string) {
    let session = this.store.getSession(connectionId);
    if (!session) {
      console.log(`Auto-creating session for ${connectionId}`);
      session = this.store.createSession(connectionId);
    }
    return session;
  }

  async onNewConnection(connectionId: string): Promise<void> {
    console.log(`New connection: ${connectionId}`);
    this.store.createSession(connectionId);

    const welcomeText =
      `Welcome to ${this.menuTitle()}!\n\n` +
      `I can verify your "${this.schema.title}" credential.\n` +
      `Please present your credential when prompted.`;

    await this.sendText(connectionId, welcomeText, SessionState.WELCOME);

    // Transition to REQUEST_PROOF and send proof request
    this.store.updateSession(connectionId, {
      state: SessionState.REQUEST_PROOF,
    });
    await this.sendProofRequest(connectionId);
  }

  async onMenuSelect(connectionId: string, menuId: string): Promise<void> {
    console.log(`Menu select from ${connectionId}: ${menuId}`);
    const session = this.ensureSession(connectionId);

    switch (menuId) {
      case "abort":
        this.store.resetSession(connectionId, SessionState.WELCOME);
        await this.sendText(
          connectionId,
          "Verification cancelled. Use the menu when you're ready to try again.",
          SessionState.WELCOME
        );
        break;

      case "verify":
      case "new_presentation":
        this.store.resetSession(connectionId, SessionState.REQUEST_PROOF);
        await this.sendProofRequest(connectionId);
        break;

      default:
        console.warn(`Unknown menu action: ${menuId}`);
        break;
    }
  }

  /**
   * Give back the chat connection of a presentation exchange, and forget the
   * exchange. Each exchange reports a result once.
   */
  takeProofConnection(proofExchangeId: string): string | undefined {
    const connectionId = this.chatByProofExchange.get(proofExchangeId);
    if (connectionId) this.chatByProofExchange.delete(proofExchangeId);
    return connectionId;
  }

  async onProofSubmit(
    connectionId: string,
    claims: Record<string, string>
  ): Promise<void> {
    console.log(`Proof received from ${connectionId}:`, claims);
    const session = this.ensureSession(connectionId);

    if (session.state !== SessionState.REQUEST_PROOF) {
      console.warn(
        `Unexpected proof for ${connectionId} in state ${session.state}`
      );
      return;
    }

    // Store verified attributes
    this.store.updateSession(connectionId, {
      state: SessionState.SHOW_RESULT,
      receivedAttributes: claims,
    });

    // Format and display results
    const attrSummary = Object.entries(claims)
      .map(([k, v]) => `  • ${k}: ${v}`)
      .join("\n");

    const resultText =
      `Credential verified successfully!\n\n` +
      `**${this.schema.title}**\n${attrSummary}\n\n` +
      `Welcome! Your identity has been verified.`;

    this.store.updateSession(connectionId, { state: SessionState.DONE });
    await this.sendText(connectionId, resultText, SessionState.DONE);
  }

  async onTextMessage(connectionId: string, text: string): Promise<void> {
    console.log(`Text from ${connectionId}: ${text}`);
    const session = this.ensureSession(connectionId);

    switch (session.state) {
      case SessionState.WELCOME:
        await this.sendText(
          connectionId,
          "Use the menu to start credential verification.",
          SessionState.WELCOME
        );
        break;

      case SessionState.REQUEST_PROOF:
        await this.sendText(
          connectionId,
          "Please present your credential using your wallet app.",
          SessionState.REQUEST_PROOF
        );
        break;

      case SessionState.DONE:
        await this.sendText(
          connectionId,
          'Use the menu to start a new verification.',
          SessionState.DONE
        );
        break;

      default:
        await this.sendText(
          connectionId,
          "Please wait while I process your request.",
          session.state
        );
        break;
    }
  }

  private async sendProofRequest(connectionId: string): Promise<void> {
    try {
      const credentialDefinitionId = this.schema.credentialDefinitionId;
      if (!credentialDefinitionId) {
        throw new Error(
          "No credential definition to request. Set ISSUER_VS_PUBLIC_URL."
        );
      }

      const attributeNames = this.schema.attributes.map((a) => a.name);

      console.log(
        `Sending proof request to ${connectionId} for attributes: ${attributeNames.join(", ")}`
      );

      const request = await this.client.createPresentationRequest({
        requestedCredentials: [
          {
            credentialDefinitionId,
            attributes: attributeNames,
          },
        ],
        autoAccept: true,
      });
      this.chatByProofExchange.set(request.proofExchangeId, connectionId);

      // The request lives on its own exchange, so the holder must open the link.
      await this.sendText(
        connectionId,
        `Open this link to present your credential: ${request.shortUrl}`,
        SessionState.REQUEST_PROOF
      );
    } catch (error) {
      console.error(
        `Failed to send proof request to ${connectionId}:`,
        error
      );
      await this.sendText(
        connectionId,
        "Sorry, failed to send the proof request. Please try again.",
        SessionState.REQUEST_PROOF
      );
    }
  }
}
