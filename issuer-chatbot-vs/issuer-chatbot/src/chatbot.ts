import { Config } from "./config";
import { VsAgentClient, ContextualMenu } from "./vs-agent-client";
import { SchemaInfo } from "./schema-reader";
import { SessionStore, SessionState } from "./session-store";

export class Chatbot {
  private client: VsAgentClient;
  private store: SessionStore;
  private schema: SchemaInfo;
  private config: Config;

  // The holder opens a second connection for the credential exchange, and the
  // exchange events name only the exchange. This map gives back the chat
  // connection that asked for the credential.
  private chatByCredentialExchange = new Map<string, string>();

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
    return `${this.config.serviceName} Issuer`;
  }

  // The agent refuses a menu that has no option, so every state offers one.
  private menuForState(state: SessionState): ContextualMenu {
    const title = this.menuTitle();
    switch (state) {
      case SessionState.COLLECT_ATTRS:
        return {
          title,
          description: "Credential issuance in progress",
          options: [
            {
              name: "abort",
              title: "Cancel",
              description: "Stop and start over",
            },
          ],
        };
      case SessionState.DONE:
        return {
          title,
          description: "Credential issued",
          options: [
            {
              name: "new_credential",
              title: "New credential",
              description: "Get another credential",
            },
          ],
        };
      default:
        return {
          title,
          description: "Welcome",
          options: [
            {
              name: "new_credential",
              title: "New credential",
              description: "Start a new credential issuance",
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
    const session = this.store.createSession(connectionId);

    const welcomeText =
      `Welcome to ${this.menuTitle()}!\n\n` +
      `I can issue you a "${this.schema.title}" credential.\n` +
      `I'll ask you for ${this.schema.attributes.length} attribute(s).`;

    await this.sendText(connectionId, welcomeText, SessionState.WELCOME);

    // Transition to COLLECT_ATTRS and prompt for first attribute
    this.store.updateSession(connectionId, {
      state: SessionState.COLLECT_ATTRS,
    });
    await this.promptNextAttribute(connectionId, session.currentAttributeIndex);
  }

  async onMenuSelect(connectionId: string, menuId: string): Promise<void> {
    console.log(`Menu select from ${connectionId}: ${menuId}`);
    const session = this.ensureSession(connectionId);

    switch (menuId) {
      case "abort":
        this.store.resetSession(connectionId, SessionState.COLLECT_ATTRS);
        await this.sendText(
          connectionId,
          "Credential issuance cancelled. Let's start over.",
          SessionState.COLLECT_ATTRS
        );
        await this.promptNextAttribute(connectionId, 0);
        break;

      case "new_credential":
        this.store.resetSession(connectionId, SessionState.COLLECT_ATTRS);
        await this.sendText(
          connectionId,
          "Starting a new credential issuance.",
          SessionState.COLLECT_ATTRS
        );
        await this.promptNextAttribute(connectionId, 0);
        break;

      default:
        console.warn(`Unknown menu action: ${menuId}`);
        break;
    }
  }

  async onTextMessage(connectionId: string, text: string): Promise<void> {
    console.log(`Text from ${connectionId}: ${text}`);
    const session = this.ensureSession(connectionId);

    switch (session.state) {
      case SessionState.COLLECT_ATTRS:
        await this.handleAttributeInput(connectionId, session, text);
        break;

      case SessionState.DONE:
        await this.sendText(
          connectionId,
          'Use the menu to issue a new credential.',
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

  /** The holder accepted the offer, so the exchange reached the state `done`. */
  async onCredentialIssued(credentialExchangeId: string): Promise<void> {
    const connectionId = this.chatByCredentialExchange.get(credentialExchangeId);
    if (!connectionId) {
      console.warn(
        `No chat connection for credential exchange ${credentialExchangeId}`
      );
      return;
    }
    this.chatByCredentialExchange.delete(credentialExchangeId);

    this.store.updateSession(connectionId, { state: SessionState.DONE });
    await this.sendText(
      connectionId,
      "Your credential is in your wallet. Enjoy the service!",
      SessionState.DONE
    );
  }

  private async handleAttributeInput(
    connectionId: string,
    session: ReturnType<SessionStore["getSession"]> & {},
    text: string
  ): Promise<void> {
    const attr = this.schema.attributes[session.currentAttributeIndex];
    if (!attr) return;

    // Store the collected attribute value
    const collected = { ...session.collectedAttributes, [attr.name]: text };
    const nextIndex = session.currentAttributeIndex + 1;

    if (nextIndex < this.schema.attributes.length) {
      // More attributes to collect
      this.store.updateSession(connectionId, {
        currentAttributeIndex: nextIndex,
        collectedAttributes: collected,
      });
      await this.promptNextAttribute(connectionId, nextIndex);
    } else {
      // All attributes collected — issue credential
      this.store.updateSession(connectionId, {
        state: SessionState.ISSUE,
        collectedAttributes: collected,
      });
      await this.issueCredential(connectionId, collected);
    }
  }

  private async promptNextAttribute(
    connectionId: string,
    index: number
  ): Promise<void> {
    const attr = this.schema.attributes[index];
    if (!attr) return;

    const requiredTag = attr.required ? " (required)" : " (optional)";
    const prompt = `Please enter your **${attr.description}**${requiredTag}:`;
    await this.sendText(connectionId, prompt, SessionState.COLLECT_ATTRS);
  }

  private async issueCredential(
    connectionId: string,
    claims: Record<string, string>
  ): Promise<void> {
    try {
      await this.sendText(
        connectionId,
        "Issuing your credential...",
        SessionState.ISSUE
      );

      console.log(
        `Issuing credential to ${connectionId} with claims:`,
        claims
      );

      // Convert flat claims to array format for the VS-Agent API
      const claimsArray = Object.entries(claims).map(([name, value]) => ({
        name,
        value,
      }));

      const offer = await this.client.createCredentialOffer({
        credentialDefinitionId: this.schema.credentialDefinitionId,
        claims: claimsArray,
        autoAccept: true,
      });
      this.chatByCredentialExchange.set(offer.credentialExchangeId, connectionId);

      // The offer lives on its own exchange, so the holder must open the link.
      // The session reaches DONE when the exchange reports `done`.
      await this.sendText(
        connectionId,
        `Open this link to receive your credential: ${offer.shortUrl}`,
        SessionState.ISSUE
      );
    } catch (error) {
      console.error(`Failed to issue credential for ${connectionId}:`, error);
      this.store.updateSession(connectionId, {
        state: SessionState.COLLECT_ATTRS,
        currentAttributeIndex: 0,
        collectedAttributes: {},
      });
      await this.sendText(
        connectionId,
        `Sorry, credential issuance failed. Please try again.`,
        SessionState.COLLECT_ATTRS
      );
      await this.promptNextAttribute(connectionId, 0);
    }
  }
}
