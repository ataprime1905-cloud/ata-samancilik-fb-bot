// ============================================================
// Queue (BullMQ)
// ============================================================
// BullMQ 5 kendi ioredis bundle'ını kullanır. Standalone ioredis
// ile type uyumsuzluğunu önlemek için Redis bağlantı konfigini
// (host/port/password) BullMQ'ya geçiyoruz; ayrıca admin/health
// check için ayrı bir standalone ioredis instance tutuyoruz.
// ============================================================

import { Queue, Worker, type WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';
import { loadEnv } from '../config/env.js';

export const COMMENT_QUEUE_NAME = 'comment-processing';
export const REPLY_QUEUE_NAME = 'reply-sending';
export const DEAD_LETTER_QUEUE_NAME = 'dead-letter';

// Standalone ioredis — sadece ping/health için kullanılır
let standaloneRedis: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!standaloneRedis) {
    const env = loadEnv();
    standaloneRedis = new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
      maxRetriesPerRequest: null,
    });
  }
  return standaloneRedis;
}

// BullMQ için bağlantı konfigürasyonu (connection options olarak)
function bullmqConnection(): { host: string; port: number; password?: string } {
  const env = loadEnv();
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  };
}

let commentQueue: Queue<CommentJobData> | null = null;
let replyQueue: Queue<ReplyJobData> | null = null;
let deadLetterQueue: Queue | null = null;

export function getCommentQueue(): Queue<CommentJobData> {
  if (!commentQueue) {
    commentQueue = new Queue<CommentJobData>(COMMENT_QUEUE_NAME, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: loadEnv().RETRY_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: loadEnv().RETRY_INITIAL_BACKOFF_MS,
        },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
      },
    });
  }
  return commentQueue;
}

export function getReplyQueue(): Queue<ReplyJobData> {
  if (!replyQueue) {
    replyQueue = new Queue<ReplyJobData>(REPLY_QUEUE_NAME, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: loadEnv().RETRY_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: loadEnv().RETRY_INITIAL_BACKOFF_MS },
      },
    });
  }
  return replyQueue;
}

export function getDeadLetterQueue(): Queue {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue(DEAD_LETTER_QUEUE_NAME, {
      connection: bullmqConnection(),
    });
  }
  return deadLetterQueue;
}

export function buildJobId(platform: string, commentId: string): string {
  return `${platform}:${commentId}`;
}

export interface CommentJobData {
  platform: string;
  commentId: string;
  receivedAt: string;
  raw?: unknown;
}

export interface ReplyJobData {
  platform: string;
  commentId: string;
  replyText: string;
  attemptNo: number;
}

export type { Worker, WorkerOptions };
