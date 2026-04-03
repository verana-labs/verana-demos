import { Config } from "./config";
import { VsAgentClient, ContextualMenu } from "./vs-agent-client";
import { SchemaInfo } from "./schema-reader";
import { SessionStore, SessionState } from "./session-store";

export class Chatbot {
  private client: VsAgentClient;
  private store: SessionStore;
  private schema: SchemaInfo;
  private config: Config;

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

  private menuForState(state: SessionState): ContextualMenu {
    const title = this.menuTitle();
    switch (state) {
      case SessionState.REQUEST_PROOF:
        return {
          title,
          description: "Waiting for credential presentation",
          options: [{ id: "abort", title: "Cancel" }],
        };
      case SessionState.DONE:
        return {
          title,
          description: "Verification complete",
          options: [
            { id: "new_presentation", title: "New presentation" },
          ],
        };
      default:
        return {
          title,
          description: "Welcome",
          options: [],
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
    const session = this.store.getSession(connectionId);
    if (!session) {
      console.warn(`No session for ${connectionId}, ignoring menu select`);
      return;
    }

    switch (menuId) {
      case "abort":
        this.store.resetSession(connectionId, SessionState.REQUEST_PROOF);
        await this.sendText(
          connectionId,
          "Verification cancelled. Let's start over.",
          SessionState.REQUEST_PROOF
        );
        await this.sendProofRequest(connectionId);
        break;

      case "new_presentation":
        this.store.resetSession(connectionId, SessionState.REQUEST_PROOF);
        await this.sendText(
          connectionId,
          "Starting a new verification.",
          SessionState.REQUEST_PROOF
        );
        await this.sendProofRequest(connectionId);
        break;

      default:
        console.warn(`Unknown menu action: ${menuId}`);
        break;
    }
  }

  async onProofSubmit(
    connectionId: string,
    claims: Record<string, string>
  ): Promise<void> {
    console.log(`Proof received from ${connectionId}:`, claims);
    const session = this.store.getSession(connectionId);
    if (!session) {
      console.warn(`No session for ${connectionId}, ignoring proof`);
      return;
    }

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
    const session = this.store.getSession(connectionId);
    if (!session) {
      console.warn(`No session for ${connectionId}, ignoring text`);
      return;
    }

    switch (session.state) {
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
      const attributeNames = this.schema.attributes.map((a) => a.name);

      console.log(
        `Sending proof request to ${connectionId} for attributes: ${attributeNames.join(", ")}`
      );

      await this.client.sendProofRequest({
        connectionId,
        requestedProofItems: [
          {
            id: crypto.randomUUID(),
            credentialDefinitionId: this.schema.credentialDefinitionId,
            type: "verifiable-credential",
            attributes: attributeNames,
          },
        ],
        contextualMenu: this.menuForState(SessionState.REQUEST_PROOF),
      });

      await this.sendText(
        connectionId,
        "I've sent a presentation request to your wallet. Please present your credential.",
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
