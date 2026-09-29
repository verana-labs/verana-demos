import { Config } from "./config";

export interface AgentInfo {
  did?: string;
  version: string;
  [key: string]: unknown;
}

export interface RequestedCredential {
  // The agent accepts one of these two ids, never both.
  credentialDefinitionId?: string;
  jsonSchemaCredentialId?: string;
  attributes?: string[];
}

export interface PresentationRequestResponse {
  proofExchangeId: string;
  invitation: Record<string, unknown>;
  shortUrl: string;
}

export interface CreatePresentationRequestParams {
  requestedCredentials: RequestedCredential[];
  requireNonRevocation?: boolean;
  autoAccept?: boolean;
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

  async createPresentationRequest(
    params: CreatePresentationRequestParams
  ): Promise<PresentationRequestResponse> {
    return this.request<PresentationRequestResponse>(
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
