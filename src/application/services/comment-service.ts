// ============================================================
// Comment Service
// ============================================================
// Yorum/processing/human review CRUD'unu izole eden katman.
// Worker ve admin controller bu service'i kullanır.
//
// Idempotency: comments tablosunda (platform, comment_id) unique.
// Aynı yorum iki kez gelirse upsert; reply iki kez gönderilmez
// çünkü processing.replyStatus="sent" işaretli.
// ============================================================

import { getPrisma, hashAuthorId } from '../../infrastructure/db.js';
import type { RawComment, RuleDecision } from '../../domain/types.js';
import { REPLY_STATUS } from '../../config/constants.js';

export interface UpsertCommentInput {
  raw: RawComment;
  rawPayload?: unknown;
}

/**
 * Yorumu upsert et + author_platform_id'yi hash'le.
 * Daha önce işlenmişse mevcut kaydı döndürür.
 */
export async function upsertComment(input: UpsertCommentInput): Promise<{
  id: string;
  isNew: boolean;
  authorHash: string;
}> {
  const prisma = getPrisma();
  const authorHash = hashAuthorId(input.raw.authorPlatformId);

  const existing = await prisma.comment.findUnique({
    where: { platform_commentId: { platform: input.raw.platform, commentId: input.raw.commentId } },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, isNew: false, authorHash };
  }

  const created = await prisma.comment.create({
    data: {
      platform: input.raw.platform,
      commentId: input.raw.commentId,
      parentCommentId: input.raw.parentCommentId ?? null,
      postId: input.raw.postId ?? null,
      pageOrIgId: input.raw.pageOrIgId ?? null,
      authorPlatformIdHash: authorHash,
      authorNameOptional: input.raw.authorName ?? null,
      commentText: input.raw.text,
      commentPermalink: input.raw.permalink ?? null,
      createdTimePlatform: input.raw.createdTimePlatform ?? null,
      rawPayloadJsonOptional: (input.rawPayload as object | undefined) ?? undefined,
    },
  });

  return { id: created.id, isNew: true, authorHash };
}

/**
 * Processing kaydını oluştur veya güncelle (upsert).
 * Her yorum için 1 processing kaydı.
 */
export async function saveProcessing(
  commentDbId: string,
  decision: RuleDecision,
  normalizedText: string,
  action: string,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.commentProcessing.upsert({
    where: { commentId: commentDbId },
    create: {
      commentId: commentDbId,
      normalizedText,
      normalizedCity: decision.city,
      intent: decision.intent,
      confidence: decision.confidence,
      decision: decision.decision,
      shouldReply: decision.replyText !== null && !decision.needsHuman,
      needsHuman: decision.needsHuman,
      humanReason: decision.humanReason,
      replyText: decision.replyText,
      replyStatus:
        action === 'send_now' || action === 'queue_for_send'
          ? REPLY_STATUS.PENDING
          : REPLY_STATUS.SKIPPED,
    },
    update: {
      normalizedText,
      normalizedCity: decision.city,
      intent: decision.intent,
      confidence: decision.confidence,
      decision: decision.decision,
      shouldReply: decision.replyText !== null && !decision.needsHuman,
      needsHuman: decision.needsHuman,
      humanReason: decision.humanReason,
      replyText: decision.replyText,
    },
  });
}

/**
 * Human review kuyruğuna ekle. Idempotent: aynı yorum iki kez eklenmez.
 */
export async function enqueueHumanReview(
  commentDbId: string,
  reason: string,
  suggestedReply: string | null,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.humanReviewQueue.upsert({
    where: { commentId: commentDbId },
    create: {
      commentId: commentDbId,
      reason,
      suggestedReply,
      status: 'pending',
    },
    update: {
      // Reason ve suggested reply güncellenebilir (workerre-run)
      reason,
      suggestedReply,
    },
  });
}

/**
 * Bir yorum daha önce başarıyla cevaplanmış mı?
 * Reply worker burası ile çift gönderim koruması yapar.
 */
export async function isAlreadyReplied(commentDbId: string): Promise<boolean> {
  const prisma = getPrisma();
  const proc = await prisma.commentProcessing.findUnique({
    where: { commentId: commentDbId },
    select: { replyStatus: true, metaReplyId: true },
  });
  return proc?.replyStatus === REPLY_STATUS.SENT && proc?.metaReplyId !== null;
}

/**
 * Reply başarılı/başarısız sonucu kaydet.
 */
export async function markReplyResult(
  commentDbId: string,
  result: {
    status: 'sent' | 'failed' | 'skipped';
    metaReplyId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const prisma = getPrisma();
  await prisma.commentProcessing.update({
    where: { commentId: commentDbId },
    data: {
      replyStatus: result.status,
      metaReplyId: result.metaReplyId ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      handledAt: new Date(),
    },
  });
}

/**
 * Reply attempt kaydı (retry istatistikleri için).
 */
export async function recordReplyAttempt(
  commentDbId: string,
  attemptNo: number,
  replyText: string,
  status: 'success' | 'rate_limited' | 'token_invalid' | 'transient_error' | 'permanent_error',
  metaResponse: unknown,
  errorCode?: string,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.replyAttempt.create({
    data: {
      commentId: commentDbId,
      attemptNo,
      replyText,
      status,
      metaResponseJson: (metaResponse as object | undefined) ?? undefined,
      errorCode: errorCode ?? null,
    },
  });
}

/**
 * Audit log helper.
 */
export async function writeAudit(
  eventType: string,
  entityType: string | null,
  entityId: string | null,
  operator: string,
  source: string,
  payloadHash?: string | null,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.auditLog.create({
    data: {
      eventType,
      entityType,
      entityId,
      payloadHash: payloadHash ?? null,
      operator,
      source,
    },
  });
}
