import { Config } from "./config";

export interface AgentInfo {
  did?: string;
  version: string;
  [key: string]: unknown;
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

export interface RequestedCredential {
  credentialDefinitionId?: string;
  jsonSchemaCredentialId?: string;
  attributes?: string[];
}

export interface CreatePresentationRequestParams {
  requestedCredentials: RequestedCredential[];
  requireNonRevocation?: boolean;
  autoAccept?: boolean;
}

export interface CreatePresentationRequestResponse {
  proofExchangeId: string;
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

  async sendMessage(params: SendMessageRequest): Promise<void> {
    await this.request<{ id: string }>("POST", "/v2/didcomm/basic-messages", {
      connectionId: params.connectionId,
      content: params.content,
    });

    if (params.contextualMenu) {
      await this.request<{ id: string }>("POST", "/v2/didcomm/action-menu", {
        connectionId: params.connectionId,
        menu: params.contextualMenu,
      });
    }
  }

  /**
   * Create a presentation request. The agent answers with an out-of-band
   * invitation. The request belongs to a new exchange, so the holder opens a
   * second connection for it. The caller sends `shortUrl` to the chat and keeps
   * the chat connection under `proofExchangeId`.
   */
  async createPresentationRequest(
    params: CreatePresentationRequestParams
  ): Promise<CreatePresentationRequestResponse> {
    return this.request<CreatePresentationRequestResponse>(
      "POST",
      "/v2/didcomm/presentation-request",
      params
    );
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
