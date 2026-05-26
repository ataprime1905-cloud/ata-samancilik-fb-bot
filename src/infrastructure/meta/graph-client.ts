// ============================================================
// Meta Graph API Client
// ============================================================
// Comment fetch + reply send + token health check.
// MVP Facebook public comment reply only; DM/private reply yok.
//
// İzin gereksinimleri (MVP):
// - pages_manage_engagement: yorum oluştur/düzenle/sil
// - pages_read_user_content: yorum oku
// - pages_read_engagement: sayfa etkileşimleri
// - pages_manage_metadata: webhook subscription
// - pages_show_list: page list
//
// Rate limit handling: response header'larında X-Business-Use-Case-Usage
// veya X-App-Usage'i izle, exponential backoff.
// ============================================================

import { loadEnv } from '../../config/env.js';
import { logger } from '../logger.js';

export interface CommentDetails {
  id: string;
  message: string;
  from?: { id: string; name?: string };
  created_time: string;
  permalink_url?: string;
  parent?: { id: string };
}

export interface ReplyResult {
  id: string;
}

export interface MetaGraphClient {
  fetchCommentDetails(commentId: string): Promise<CommentDetails>;
  replyToFacebookComment(commentId: string, message: string): Promise<ReplyResult>;
  hideComment(commentId: string): Promise<boolean>;
  healthCheckToken(): Promise<{ valid: boolean; expiresAt?: number; scopes?: string[] }>;
  validatePermissions(): Promise<{ ok: boolean; missing: string[] }>;
}

const REQUIRED_PERMISSIONS_FB = [
  'pages_manage_engagement',
  'pages_read_user_content',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_show_list',
];

export class RealMetaGraphClient implements MetaGraphClient {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly pageAccessToken: string;

  constructor(opts?: { baseUrl?: string; apiVersion?: string; pageAccessToken?: string }) {
    const env = loadEnv();
    this.baseUrl = opts?.baseUrl ?? env.META_GRAPH_API_BASE_URL;
    this.apiVersion = opts?.apiVersion ?? env.META_GRAPH_API_VERSION;
    this.pageAccessToken = opts?.pageAccessToken ?? env.META_PAGE_ACCESS_TOKEN ?? '';
    if (!this.pageAccessToken) {
      logger.warn('META_PAGE_ACCESS_TOKEN is empty — real Graph calls will fail');
    }
  }

  private url(path: string): string {
    return `${this.baseUrl}/${this.apiVersion}${path}`;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(this.url(path));
    if (method === 'GET' && body) {
      for (const [k, v] of Object.entries(body)) {
        url.searchParams.set(k, String(v));
      }
    }
    url.searchParams.set('access_token', this.pageAccessToken);

    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method !== 'GET' && body) init.body = JSON.stringify(body);

    const res = await fetch(url.toString(), init);
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const error = (json as { error?: { code?: number; message?: string; type?: string } }).error;
      // Rate limit (code 4, 17, 32, 613, 80004) handling caller side
      throw new MetaGraphError(
        error?.message ?? `Graph API error: ${res.status}`,
        error?.code,
        error?.type,
        res.status,
      );
    }
    return json as T;
  }

  async fetchCommentDetails(commentId: string): Promise<CommentDetails> {
    return this.request<CommentDetails>('GET', `/${commentId}`, {
      fields: 'id,message,from,created_time,permalink_url,parent',
    });
  }

  async replyToFacebookComment(commentId: string, message: string): Promise<ReplyResult> {
    return this.request<ReplyResult>('POST', `/${commentId}/comments`, { message });
  }

  async hideComment(commentId: string): Promise<boolean> {
    await this.request<unknown>('POST', `/${commentId}`, { is_hidden: true });
    return true;
  }

  async healthCheckToken(): Promise<{ valid: boolean; expiresAt?: number; scopes?: string[] }> {
    try {
      const env = loadEnv();
      // debug_token endpoint için app access token gerekir (app_id|app_secret).
      // Burada basit /me sorgusu ile token geçerliliğini kontrol ediyoruz.
      await this.request<unknown>('GET', '/me');
      return { valid: true };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'token health check failed');
      return { valid: false };
    }
  }

  async validatePermissions(): Promise<{ ok: boolean; missing: string[] }> {
    try {
      const res = await this.request<{ data: Array<{ permission: string; status: string }> }>(
        'GET',
        '/me/permissions',
      );
      const granted = new Set(
        res.data.filter((p) => p.status === 'granted').map((p) => p.permission),
      );
      const missing = REQUIRED_PERMISSIONS_FB.filter((p) => !granted.has(p));
      return { ok: missing.length === 0, missing };
    } catch (err) {
      return { ok: false, missing: REQUIRED_PERMISSIONS_FB };
    }
  }
}

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly type?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }

  /**
   * Rate-limit hata kodları:
   * 4 = Application request limit reached
   * 17 = User request limit reached
   * 32 = Page request limit reached
   * 613 = Custom rate limit
   */
  isRateLimit(): boolean {
    return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613;
  }

  /**
   * Token invalid: 190 (OAuth access token expired/invalid)
   */
  isTokenInvalid(): boolean {
    return this.code === 190;
  }

  isPermissionError(): boolean {
    return this.code === 200 || this.code === 10;
  }
}
