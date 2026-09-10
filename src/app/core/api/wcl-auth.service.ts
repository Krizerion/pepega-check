import { Injectable, computed, signal } from '@angular/core';

import { WclCredentials, WclToken } from '../models/wcl';

const CREDENTIALS_KEY = 'pepega-check.wcl-credentials';
const TOKEN_KEY = 'pepega-check.wcl-token';
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';

/** Safety margin subtracted from the token lifetime before we refresh. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Optional runtime configuration shipped next to the app (public/app-config.json).
 * Either field lets teammates use the app with zero setup:
 * - `sharedToken` / `sharedTokenExpiresAt`: a bearer token embedded at deploy
 *   time (CI exchanges the guild's secret for it; the secret never ships).
 * - `tokenUrl`: a token broker (e.g. a Cloudflare Worker) that holds the
 *   secret server-side and returns { access_token, expires_in }.
 */
interface AppConfig {
  tokenUrl?: string | null;
  sharedToken?: string | null;
  sharedTokenExpiresAt?: number | null;
}

/**
 * Manages Warcraft Logs OAuth client-credentials auth entirely in the browser.
 * Credentials and the short-lived access token live in localStorage only.
 */
@Injectable({ providedIn: 'root' })
export class WclAuthService {
  private readonly credentialsSignal = signal<WclCredentials | null>(readJson(CREDENTIALS_KEY));
  private readonly tokenSignal = signal<WclToken | null>(readJson(TOKEN_KEY));

  readonly credentials = this.credentialsSignal.asReadonly();
  readonly isConfigured = computed(() => this.credentialsSignal() !== null || this.hasValidToken());

  setCredentials(credentials: WclCredentials): void {
    this.credentialsSignal.set(credentials);
    writeJson(CREDENTIALS_KEY, credentials);
    this.clearToken();
  }

  /** Stores a manually acquired bearer token (fallback when the token endpoint is unreachable). */
  setManualToken(accessToken: string, lifetimeMs = 24 * 3600_000): void {
    const token: WclToken = { accessToken, expiresAt: Date.now() + lifetimeMs };
    this.tokenSignal.set(token);
    writeJson(TOKEN_KEY, token);
  }

  clearAll(): void {
    this.credentialsSignal.set(null);
    localStorage.removeItem(CREDENTIALS_KEY);
    this.clearToken();
  }

  hasValidToken(): boolean {
    const token = this.tokenSignal();
    return token !== null && token.expiresAt - EXPIRY_MARGIN_MS > Date.now();
  }

  /**
   * Returns a valid access token. Priority: cached token, then locally stored
   * client credentials, then the deployment's shared token broker (tokenUrl).
   */
  async getAccessToken(): Promise<string> {
    const cached = this.tokenSignal();
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return cached.accessToken;
    }

    const credentials = this.credentialsSignal();
    if (!credentials) {
      const deploymentToken = await this.fetchDeploymentToken();
      if (deploymentToken) {
        return deploymentToken;
      }
      throw new Error(
        'Warcraft Logs API is not configured. Open Settings and enter your client credentials.',
      );
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }).catch(() => {
      throw new Error(
        'Could not reach the Warcraft Logs token endpoint from the browser. ' +
          'Paste an access token manually in Settings instead.',
      );
    });

    if (!response.ok) {
      throw new Error(
        `Token request failed (${response.status}). Check your client ID and secret in Settings.`,
      );
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    const token: WclToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    this.tokenSignal.set(token);
    writeJson(TOKEN_KEY, token);
    return token.accessToken;
  }

  private clearToken(): void {
    this.tokenSignal.set(null);
    localStorage.removeItem(TOKEN_KEY);
  }

  private appConfig: Promise<AppConfig> | null = null;

  private loadAppConfig(): Promise<AppConfig> {
    this.appConfig ??= fetch(new URL('app-config.json', document.baseURI))
      .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : {}))
      .catch(() => ({}));
    return this.appConfig;
  }

  /** Resolves the deployment-wide token: embedded shared token or token broker. */
  private async fetchDeploymentToken(): Promise<string | null> {
    const config = await this.loadAppConfig();

    if (config.sharedToken && (config.sharedTokenExpiresAt ?? 0) - EXPIRY_MARGIN_MS > Date.now()) {
      return config.sharedToken;
    }

    if (!config.tokenUrl) {
      return null;
    }
    const response = await fetch(config.tokenUrl).catch(() => null);
    if (!response?.ok) {
      throw new Error(
        'The shared Warcraft Logs token service is unreachable. ' +
          'Try again later, or enter your own credentials in Settings.',
      );
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    const token: WclToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    this.tokenSignal.set(token);
    writeJson(TOKEN_KEY, token);
    return token.accessToken;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode etc.) — the app still works for the session.
  }
}
