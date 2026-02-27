import axios from 'axios';
import { config } from '../config';
import { sessionStore } from './sessionStore';

export interface HLAgent {
  id: string;
  name: string;
  systemPrompt?: string;
  description?: string;
  phoneNumber?: string;
  status?: string;
  [key: string]: unknown;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  locationId?: string;
  userId?: string;
  companyId?: string;
}

export interface UserInfoResponse {
  locationId?: string;
  userId?: string;
  companyId?: string;
  [key: string]: unknown;
}

class HLClient {
  private get authHeaders() {
    const session = sessionStore.get();
    if (!session) throw new Error('Not authenticated');
    return {
      Authorization: `Bearer ${session.accessToken}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    };
  }

  private get locationId(): string {
    const session = sessionStore.get();
    if (!session?.locationId) throw new Error('No locationId in session');
    return session.locationId;
  }

  async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.hl.clientId,
      client_secret: config.hl.clientSecret,
      redirect_uri: config.hl.redirectUri,
      user_type: 'Location',
    });

    const response = await axios.post(
      `${config.hl.apiBaseUrl}/oauth/token`,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    return response.data;
  }

  async getUserInfo(): Promise<UserInfoResponse> {
    const response = await axios.get(`${config.hl.apiBaseUrl}/oauth/me`, {
      headers: this.authHeaders,
    });
    return response.data;
  }

  async getAgents(): Promise<HLAgent[]> {
    try {
      const response = await axios.get(
        `${config.hl.apiBaseUrl}/voice-ai/agents`,
        {
          headers: this.authHeaders,
          params: { locationId: this.locationId },
        },
      );
      return response.data?.agents || response.data || [];
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  async getAgent(agentId: string): Promise<HLAgent> {
    const response = await axios.get(
      `${config.hl.apiBaseUrl}/voice-ai/agents/${agentId}`,
      {
        headers: this.authHeaders,
        params: { locationId: this.locationId },
      },
    );
    return response.data?.agent || response.data;
  }

  async updateAgent(agentId: string, systemPrompt: string): Promise<HLAgent> {
    const currentAgent = await this.getAgent(agentId);
    const response = await axios.put(
      `${config.hl.apiBaseUrl}/voice-ai/agents/${agentId}`,
      { ...currentAgent, systemPrompt },
      { headers: this.authHeaders },
    );
    return response.data?.agent || response.data;
  }
}

export const hlClient = new HLClient();
