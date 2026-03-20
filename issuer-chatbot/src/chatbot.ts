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
    return `${this.config.serviceName} Issuer`;
  }

  private menuForState(state: SessionState): ContextualMenu {
    const title = this.menuTitle();
    switch (state) {
      case SessionState.COLLECT_ATTRS:
        return {
          title,
          description: "Credential issuance in progress",
          options: [{ id: "abort", title: "Cancel" }],
        };
      case SessionState.DONE:
        return {
          title,
          description: "Credential issued",
          options: [{ id: "new_credential", title: "New credential" }],
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
    const session = this.store.getSession(connectionId);
    if (!session) {
      console.warn(`No session for ${connectionId}, ignoring menu select`);
      return;
    }

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
    const session = this.store.getSession(connectionId);
    if (!session) {
      console.warn(`No session for ${connectionId}, ignoring text`);
      return;
    }

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

      // Get the connection's DID for the credential subject
      const agent = await this.client.getAgent();
      const format = this.config.enableAnoncreds ? "anoncreds" : "jsonld";

      console.log(
        `Issuing ${format} credential to ${connectionId} with claims:`,
        claims
      );

      await this.client.issueCredential({
        format: format as "jsonld" | "anoncreds",
        did: connectionId,
        jsonSchemaCredentialId: this.schema.vtjscId,
        claims,
      });

      this.store.updateSession(connectionId, { state: SessionState.DONE });

      const attrSummary = Object.entries(claims)
        .map(([k, v]) => `  • ${k}: ${v}`)
        .join("\n");

      await this.sendText(
        connectionId,
        `Credential issued successfully!\n\n` +
          `**${this.schema.title}**\n${attrSummary}\n\n` +
          `The credential has been sent to your wallet.`,
        SessionState.DONE
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
