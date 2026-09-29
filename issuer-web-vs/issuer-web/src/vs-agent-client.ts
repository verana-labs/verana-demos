import { Config } from "./config";

export interface AgentInfo {
  did?: string;
  version: string;
  [key: string]: unknown;
}

export interface CredentialOfferClaim {
  name: string;
  value: string;
  mimeType?: string;
}

export interface CredentialOfferResponse {
  credentialExchangeId: string;
  invitation: Record<string, unknown>;
  shortUrl: string;
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
}

// Every v2 list answers one page. The caller repeats the call with nextCursor
// until the agent answers null.
export interface CredentialDefinitionPage {
  items: CredentialDefinition[];
  nextCursor: string | null;
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

  async createCredentialOfferInvitation(
    credentialDefinitionId: string,
    claims: CredentialOfferClaim[]
  ): Promise<CredentialOfferResponse> {
    // The agent waits for an explicit accept call unless autoAccept is true. This
    // application runs no issuer step of its own, so the agent must issue the
    // credential on its own.
    return this.request<CredentialOfferResponse>(
      "POST",
      "/v2/didcomm/credential-offer",
      { credentialDefinitionId, claims, autoAccept: true }
    );
  }

  async listCredentialDefinitions(
    cursor?: string
  ): Promise<CredentialDefinitionPage> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request<CredentialDefinitionPage>(
      "GET",
      `/v2/anoncreds/credential-definitions${query}`
    );
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
