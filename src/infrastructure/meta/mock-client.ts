// ============================================================
// Mock Meta Graph Client
// ============================================================
// Test ve dry-run modunda kullanılır. Gerçek API çağrısı YAPMAZ.
// PREVIEW_ONLY mode'da ve development'ta default.
// ============================================================

import type { MetaGraphClient, CommentDetails, ReplyResult } from './graph-client.js';

export class MockMetaGraphClient implements MetaGraphClient {
  private sentReplies: Array<{ commentId: string; message: string; createdAt: Date }> = [];

  async fetchCommentDetails(commentId: string): Promise<CommentDetails> {
    return {
      id: commentId,
      message: '[mock comment text]',
      from: { id: 'mock-user-id', name: 'Mock User' },
      created_time: new Date().toISOString(),
      permalink_url: `https://facebook.com/mock/${commentId}`,
    };
  }

  async replyToFacebookComment(commentId: string, message: string): Promise<ReplyResult> {
    const replyId = `mock-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sentReplies.push({ commentId, message, createdAt: new Date() });
    return { id: replyId };
  }

  async hideComment(_commentId: string): Promise<boolean> {
    return true;
  }

  async healthCheckToken(): Promise<{ valid: boolean; expiresAt?: number; scopes?: string[] }> {
    return { valid: true, scopes: ['pages_manage_engagement', 'pages_read_user_content'] };
  }

  async validatePermissions(): Promise<{ ok: boolean; missing: string[] }> {
    return { ok: true, missing: [] };
  }

  // Test/inspection helper
  getSentReplies(): ReadonlyArray<{ commentId: string; message: string; createdAt: Date }> {
    return [...this.sentReplies];
  }

  reset(): void {
    this.sentReplies = [];
  }
}
