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

export interface CredentialOfferClaim {
  name: string;
  value: string;
  mimeType?: string;
}

export interface CredentialOfferResponse {
  credentialExchangeId: string;
  url: string;
  shortUrl: string;
}

export interface CreateCredentialTypeRequest {
  name: string;
  version: string;
  attributes?: string[];
  relatedJsonSchemaCredentialId?: string;
  supportRevocation: boolean;
}

export interface CredentialType {
  id: string;
  name: string;
  version: string;
  relatedJsonSchemaCredentialId?: string;
  [key: string]: unknown;
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

  async createCredentialOfferInvitation(
    credentialDefinitionId: string,
    claims: CredentialOfferClaim[]
  ): Promise<CredentialOfferResponse> {
    return this.request<CredentialOfferResponse>(
      "POST",
      "/v1/invitation/credential-offer",
      { credentialDefinitionId, claims }
    );
  }

  async getCredentialTypes(): Promise<CredentialType[]> {
    return this.request<CredentialType[]>("GET", "/v1/credential-types");
  }

  async createCredentialType(
    params: CreateCredentialTypeRequest
  ): Promise<CredentialType> {
    return this.request<CredentialType>(
      "POST",
      "/v1/credential-types",
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
