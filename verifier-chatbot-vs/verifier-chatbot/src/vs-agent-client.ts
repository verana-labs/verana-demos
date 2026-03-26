import { Config } from "./config";

export interface AgentInfo {
  publicDid: string;
  label: string;
  [key: string]: unknown;
}

export interface VtjscCredential {
  id: string;
  credentialSubject?: {
    jsonSchema?: { $ref: string } | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface VtjscEntry {
  credential: VtjscCredential;
  schemaId: string;
  [key: string]: unknown;
}

export interface VtjscListResponse {
  data: VtjscEntry[];
}

export interface ContextualMenuEntry {
  id: string;
  title: string;
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

export interface ProofRequestItem {
  credentialDefinitionId?: string;
  type: string;
  attributes: string[];
}

export interface SendProofRequestParams {
  connectionId: string;
  proofRequestItems: ProofRequestItem[];
  contextualMenu?: ContextualMenu;
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
    return this.request<AgentInfo>("GET", "/v1/agent");
  }

  async getJsonSchemaCredentials(): Promise<VtjscListResponse> {
    return this.request<VtjscListResponse>(
      "GET",
      "/v1/vt/json-schema-credentials"
    );
  }

  async sendMessage(params: SendMessageRequest): Promise<void> {
    await this.request<unknown>("POST", "/v1/message", {
      type: "text",
      connectionId: params.connectionId,
      content: params.content,
    });

    if (params.contextualMenu) {
      await this.request<unknown>("POST", "/v1/message", {
        type: "contextual-menu-update",
        connectionId: params.connectionId,
        title: params.contextualMenu.title,
        description: params.contextualMenu.description,
        options: params.contextualMenu.options,
      });
    }
  }

  async sendProofRequest(params: SendProofRequestParams): Promise<void> {
    await this.request<unknown>("POST", "/v1/message", params);
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
