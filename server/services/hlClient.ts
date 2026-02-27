import axios from 'axios';
import { config } from '../config';
import { sessionStore } from './sessionStore';
import { logger } from '../logger';

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

  private normalizeAgent(raw: Record<string, unknown>): HLAgent {
    return {
      ...raw,
      id: raw.id as string,
      name: (raw.agentName || raw.name || 'Unnamed Agent') as string,
      systemPrompt: (raw.agentPrompt || raw.systemPrompt || '') as string,
      description: (raw.businessName || raw.description || '') as string,
      status: (raw.status || 'active') as string,
      phoneNumber: (raw.inboundNumber || raw.phoneNumber || '') as string,
    };
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
      const raw: Record<string, unknown>[] = response.data?.agents || response.data || [];
      return raw.map((a) => this.normalizeAgent(a));
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
    const raw = response.data?.agent || response.data;
    return this.normalizeAgent(raw);
  }

  async updateAgent(agentId: string, systemPrompt: string): Promise<HLAgent> {
    const url = `${config.hl.apiBaseUrl}/voice-ai/agents/${agentId}`;
    const body = { agentPrompt: systemPrompt };
    logger.debug('PATCH updateAgent', { url, locationId: this.locationId, bodyKeys: Object.keys(body) });
    try {
      const response = await axios.patch(url, body, { headers: this.authHeaders });
      const updated = response.data?.agent || response.data;
      return this.normalizeAgent(updated);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        logger.error('updateAgent HL error', {
          status: err.response?.status,
          responseData: err.response?.data,
          requestUrl: url,
        });
      }
      throw err;
    }
  }
}

export const hlClient = new HLClient();
