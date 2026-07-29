import { ImapFlow } from 'imapflow';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { LeadModel } from '../leads/lead.model.js';
import { applyStatus, cancelPendingMessages } from '../leads/lead.service.js';
import { classifyIncoming, type IncomingHeaders } from './reply-detector.js';
import { extractReplyText } from './reply-text.js';

export type ReplyPollStats = {
  scanned: number;
  replies: number;
  bounces: number;
  autoReplies: number;
  ignored: number;
};

let lastSuccessfulPollAt: Date | undefined;

/**
 * Follow-ups depend on knowing whether someone already replied. If polling is
 * off or stale, the follow-up scan refuses to run rather than risk chasing
 * someone who has already answered.
 */
export const isReplyDetectionHealthy = (): boolean => {
  if (!env.IMAP_ENABLED) {
    return false;
  }

  if (!lastSuccessfulPollAt) {
    return false;
  }

  const ageHours = (Date.now() - lastSuccessfulPollAt.getTime()) / 3_600_000;
  return ageHours <= env.IMAP_MAX_STALE_HOURS;
};

export const getLastPollAt = () => lastSuccessfulPollAt;

const headerValue = (headers: Map<string, string[] | string> | undefined, key: string) => {
  const value = headers?.get(key);
  return Array.isArray(value) ? value[0] : value;
};

const handleReply = async (
  email: string,
  stats: ReplyPollStats,
  received?: { subject?: string; snippet: string },
) => {
  const lead = await LeadModel.findOne({
    contactEmail: email,
    status: { $nin: ['unsubscribed', 'bounced', 'do_not_contact', 'won', 'lost'] },
  });

  if (!lead) {
    stats.ignored += 1;
    return;
  }

  lead.repliedAt = new Date();
  lead.nextFollowUpAt = null;

  // Polling re-reads the last 14 days, so the same reply is seen repeatedly.
  const alreadyStored = lead.replies.some(
    (reply) => reply.snippet === received?.snippet && reply.fromEmail === email,
  );

  if (received?.snippet && !alreadyStored) {
    lead.replies.push({
      fromEmail: email,
      subject: received.subject,
      snippet: received.snippet,
      receivedAt: new Date(),
    });
  }
  await applyStatus(lead, 'replied', 'reply received');
  await lead.save();
  await cancelPendingMessages(lead._id, 'lead replied');

  stats.replies += 1;
  logger.info({ leadId: lead.id }, 'Reply detected, sequence stopped');
};

const handleBounce = async (email: string | undefined, hard: boolean, stats: ReplyPollStats) => {
  if (!email) {
    stats.ignored += 1;
    return;
  }

  const lead = await LeadModel.findOne({ contactEmail: email });

  if (lead) {
    lead.nextFollowUpAt = null;
    await applyStatus(lead, 'bounced', hard ? 'hard bounce' : 'soft bounce');
    await lead.save();
    await cancelPendingMessages(lead._id, 'address bounced');
  }

  // Only a hard bounce is permanent enough to suppress forever.
  if (hard) {
    await suppressionService.add({
      type: 'email',
      value: email,
      reason: 'bounced',
      note: 'Hard bounce detected via IMAP',
      leadId: lead?.id,
    });
  }

  stats.bounces += 1;
};

export const inboxService = {
  async runReplyPoll(): Promise<ReplyPollStats> {
    const stats: ReplyPollStats = { scanned: 0, replies: 0, bounces: 0, autoReplies: 0, ignored: 0 };

    if (!env.IMAP_ENABLED || !env.IMAP_USER || !env.IMAP_PASSWORD) {
      logger.debug('IMAP disabled, skipping reply poll');
      return stats;
    }

    const client = new ImapFlow({
      host: env.IMAP_HOST,
      port: env.IMAP_PORT,
      secure: true,
      auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const since = new Date();
        since.setUTCHours(since.getUTCHours() - 24 * 14);

        for await (const message of client.fetch(
          { since },
          {
            envelope: true,
            headers: ['auto-submitted', 'precedence', 'return-path'],
            // Needed to store a preview of what the lead actually wrote back.
            source: true,
          },
          // Never mark read or move: the operator's inbox must look untouched.
          { uid: true, changedSince: undefined },
        )) {
          stats.scanned += 1;

          const headers: IncomingHeaders = {
            from: message.envelope?.from?.[0]?.address
              ? `${message.envelope.from[0].name ?? ''} <${message.envelope.from[0].address}>`
              : undefined,
            subject: message.envelope?.subject,
            autoSubmitted: headerValue(message.headers as never, 'auto-submitted'),
            precedence: headerValue(message.headers as never, 'precedence'),
            returnPath: headerValue(message.headers as never, 'return-path'),
          };

          const classification = classifyIncoming(headers, message.envelope?.subject ?? '');

          switch (classification.kind) {
            case 'reply': {
              const snippet = message.source
                ? extractReplyText(message.source.toString('utf8'))
                : '';

              await handleReply(classification.email, stats, {
                subject: message.envelope?.subject,
                snippet,
              });
              break;
            }
            case 'bounce':
              await handleBounce(classification.email, classification.hard, stats);
              break;
            case 'auto_reply':
              stats.autoReplies += 1;
              break;
            default:
              stats.ignored += 1;
          }
        }
      } finally {
        lock.release();
      }

      lastSuccessfulPollAt = new Date();
      logger.info({ stats }, 'Reply poll complete');
    } catch (error) {
      logger.error({ error }, 'IMAP reply poll failed');
      throw error;
    } finally {
      await client.logout().catch(() => undefined);
    }

    return stats;
  },
};
