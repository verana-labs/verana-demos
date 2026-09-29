import { Config } from "./config";

export interface AgentInfo {
  did?: string;
  version: string;
  [key: string]: unknown;
}

/** A page of a v2 list route. `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateCredentialDefinitionRequest {
  relatedJsonSchemaCredentialId: string;
  supportRevocation?: boolean;
}

export interface CredentialDefinition {
  id: string;
  name: string;
  version: string;
  attributes: string[];
  supportRevocation: boolean;
  relatedJsonSchemaCredentialId: string;
  [key: string]: unknown;
}

export interface CredentialIssuanceClaim {
  name: string;
  value: string;
  mimeType?: string;
}

export interface ContextualMenuEntry {
  name: string;
  title: string;
  description: string;
}

export interface ContextualMenu {
  title: string;
  description: string;
  options: ContextualMenuEntry[];
}

export interface SendMessageRequest {
  connectionId: string;
  content: string;
  contextualMenu?: ContextualMenu;
}

export interface CreateCredentialOfferRequest {
  credentialDefinitionId: string;
  claims: CredentialIssuanceClaim[];
  autoAccept?: boolean;
}

export interface CreateCredentialOfferResponse {
  credentialExchangeId: string;
  invitation: Record<string, unknown>;
  shortUrl: string;
}

export class VsAgentClient {
  private baseUrl: string;

  constructor(config: Config) {
    this.baseUrl = config.vsAgentAdminUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `VS-Agent API error: ${method} ${path} returned ${response.status}: ${text}`
      );
    }
    return response.json() as Promise<T>;
  }

  async getAgent(): Promise<AgentInfo> {
    return this.request<AgentInfo>("GET", "/v2/agent/info");
  }

  /** Read every page of the credential definitions of this agent. */
  async getCredentialDefinitions(): Promise<CredentialDefinition[]> {
    const all: CredentialDefinition[] = [];
    let cursor: string | null = null;
    do {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page: Page<CredentialDefinition> = await this.request<
        Page<CredentialDefinition>
      >("GET", `/v2/anoncreds/credential-definitions${query}`);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  }

  async createCredentialDefinition(
    params: CreateCredentialDefinitionRequest
  ): Promise<CredentialDefinition> {
    return this.request<CredentialDefinition>(
      "POST",
      "/v2/anoncreds/credential-definitions",
      params
    );
  }

  /**
   * Create a credential offer. The agent answers with an out-of-band invitation.
   * The offer belongs to a new exchange, so the holder opens a second connection
   * for it. The caller sends `shortUrl` to the chat and keeps the chat
   * connection under `credentialExchangeId`.
   */
  async createCredentialOffer(
    params: CreateCredentialOfferRequest
  ): Promise<CreateCredentialOfferResponse> {
    return this.request<CreateCredentialOfferResponse>(
      "POST",
      "/v2/didcomm/credential-offer",
      params
    );
  }

  async sendMessage(params: SendMessageRequest): Promise<void> {
    // Send text message
    await this.request<{ id: string }>("POST", "/v2/didcomm/basic-messages", {
      connectionId: params.connectionId,
      content: params.content,
    });

    // Send contextual menu update if provided
    if (params.contextualMenu) {
      await this.request<{ id: string }>("POST", "/v2/didcomm/action-menu", {
        connectionId: params.connectionId,
        menu: params.contextualMenu,
      });
    }
  }

  async waitForReady(
    maxRetries: number = 30,
    intervalMs: number = 2000
  ): Promise<AgentInfo> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.getAgent();
      } catch {
        if (i < maxRetries - 1) {
          console.log(
            `Waiting for VS-Agent at ${this.baseUrl}... (${i + 1}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
    }
    throw new Error(
      `VS-Agent not reachable at ${this.baseUrl} after ${maxRetries} retries`
    );
  }
}
