import type { ApiVersion, CircleConfig } from '../config.js';

const V1_BASE = 'https://app.circle.so/api/v1';
const V2_BASE = 'https://app.circle.so/api/admin/v2';

export function baseUrlFor(config: CircleConfig): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/+$/, '');
  return config.apiVersion === 'v1' ? V1_BASE : V2_BASE;
}

/**
 * Admin API v1 authenticates with `Token <token>`; v2 with `Bearer <token>`.
 * Sending the wrong scheme is the most common cause of a 401 here.
 */
export function authHeader(version: ApiVersion, token: string): string {
  return version === 'v1' ? `Token ${token}` : `Bearer ${token}`;
}

export class CircleApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly url: string,
    readonly body: string,
  ) {
    super(`Circle API ${status} on ${method} ${url}\n${body}`);
    this.name = 'CircleApiError';
  }

  /** Turn the raw failure into something actionable. */
  get hint(): string | null {
    switch (this.status) {
      case 401:
      case 403:
        return (
          'Token rejected. Check that (a) CIRCLE_API_TOKEN is current, and (b) the token type in\n' +
          'Circle (Settings -> Developers -> Tokens) matches "apiVersion" in circle.config.json —\n' +
          'an Admin V1 token will not authenticate against the v2 API, and vice versa.'
        );
      case 404:
        return 'Not found. Usually a wrong space id — run `circle spaces` to list the real ones.';
      case 422:
        return 'Circle rejected the payload. The message above names the offending field.';
      case 429:
        return 'Rate limited by Circle. Wait a moment and retry.';
      default:
        return null;
    }
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface ClientOptions {
  config: CircleConfig;
  token: string;
  /** Print the request instead of sending it. */
  dryRun?: boolean;
  verbose?: boolean;
}

export class CircleClient {
  constructor(private readonly opts: ClientOptions) {}

  get dryRun(): boolean {
    return this.opts.dryRun ?? false;
  }

  buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(
      baseUrlFor(this.opts.config) + (path.startsWith('/') ? path : `/${path}`),
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);

    if (this.dryRun) {
      process.stdout.write(
        `\n[dry-run] ${method} ${url}\n` +
          `[dry-run] Authorization: ${this.opts.config.apiVersion === 'v1' ? 'Token' : 'Bearer'} ***\n` +
          (options.body
            ? `[dry-run] body:\n${JSON.stringify(options.body, null, 2)}\n`
            : '') +
          '[dry-run] not sent.\n',
      );
      return { dryRun: true } as T;
    }

    if (this.opts.verbose) {
      process.stderr.write(`-> ${method} ${url}\n`);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(this.opts.config.apiVersion, this.opts.token),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new CircleApiError(response.status, method, url, text.slice(0, 2000));
    }
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Circle returned non-JSON on ${method} ${url}:\n${text.slice(0, 500)}`,
      );
    }
  }
}
