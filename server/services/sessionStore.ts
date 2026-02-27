export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  locationId: string;
  userId?: string;
  companyId?: string;
}

class SessionStore {
  private session: Session | null = null;

  set(session: Session): void {
    this.session = session;
  }

  get(): Session | null {
    return this.session;
  }

  clear(): void {
    this.session = null;
  }

  hasValidToken(): boolean {
    if (!this.session) return false;
    // 60s buffer before expiry
    return Date.now() < this.session.expiresAt - 60_000;
  }
}

export const sessionStore = new SessionStore();
