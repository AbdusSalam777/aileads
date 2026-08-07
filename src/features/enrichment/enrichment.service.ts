import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { LeadModel, type LeadDocument } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';
import { pickBestEmail } from './email-extract.js';
import { scrapeSite } from './scraper.js';

export type EnrichmentStats = {
  processed: number;
  enriched: number;
  unreachable: number;
  manual: number;
  suppressed: number;
};

const MAX_ATTEMPTS = 3;

/**
 * Intent posts often carry the address inline, so re-check the post text before
 * spending a network round trip on the linked site.
 */
const emailFromIntent = (lead: LeadDocument) => {
  if (lead.contactEmail) {
    return { email: lead.contactEmail, confidence: lead.contactEmailConfidence || 0.8 };
  }

  if (!lead.intent) {
    return undefined;
  }

  return pickBestEmail(`${lead.intent.title}\n${lead.intent.excerpt}`, lead.websiteUrl);
};

const finish = async (
  lead: LeadDocument,
  status: 'enriched' | 'unreachable' | 'manual_action',
  reason: string,
) => {
  await applyStatus(lead, status, reason);
  await lead.save();
};

const enrichOne = async (lead: LeadDocument, stats: EnrichmentStats) => {
  await applyStatus(lead, 'enriching', 'enrichment started');
  lead.enrichmentAttempts += 1;
  await lead.save();

  const inline = emailFromIntent(lead);
  let email = inline?.email;
  let confidence = inline?.confidence ?? 0;

  if (lead.websiteUrl) {
    const result = await scrapeSite(lead.websiteUrl);

    if (result.ok && result.site) {
      lead.site = {
        fetchedAt: new Date(),
        finalUrl: result.finalUrl,
        statusCode: result.statusCode,
        title: result.site.title,
        description: result.site.description,
        excerpt: result.site.excerpt,
        techSignals: result.site.techSignals,
        emailsFound: result.emailsFound,
        hasViewport: result.site.hasViewport,
        hasHttps: !result.site.techSignals.includes('no-https'),
        hasVideo: result.site.hasVideo,
        copyrightYear: result.site.copyrightYear,
        phone: result.site.phone,
        address: result.site.address,
        socialLinks: result.site.socialLinks,
      };
      lead.enrichmentError = undefined;

      if (!email && result.email) {
        email = result.email;
        confidence = result.emailConfidence ?? 0.5;
      }
    } else {
      lead.enrichmentError = result.error;
    }
  }

  if (!email) {
    // No address anywhere. Intent leads still have a post the operator can reply
    // to by hand, so they are actionable; fit leads are simply unreachable.
    if (lead.sourceKind === 'intent' && lead.sourceUrl) {
      lead.contactChannel = 'manual';
      lead.contactNote = 'No email found — apply or message via the original post';
      stats.manual += 1;
      await finish(lead, 'manual_action', 'no email address found');
      return;
    }

    if (lead.enrichmentAttempts >= MAX_ATTEMPTS || !lead.websiteUrl) {
      lead.contactChannel = 'unknown';
      stats.unreachable += 1;
      await finish(lead, 'unreachable', lead.enrichmentError ?? 'no email address found');
      return;
    }

    stats.unreachable += 1;
    await finish(lead, 'unreachable', lead.enrichmentError ?? 'no email address found');
    return;
  }

  if (await suppressionService.isSuppressed(email)) {
    lead.contactEmail = email;
    lead.contactChannel = 'email';
    stats.suppressed += 1;
    await applyStatus(lead, 'do_not_contact', 'address is on the suppression list');
    await lead.save();
    return;
  }

  lead.contactEmail = email;
  lead.contactEmailConfidence = confidence;
  lead.contactChannel = 'email';
  stats.enriched += 1;
  await finish(lead, 'enriched', 'contact details found');
};

export const enrichmentService = {
  async runEnrichment(limit = env.ENRICH_BATCH_SIZE): Promise<EnrichmentStats> {
    const stats: EnrichmentStats = {
      processed: 0,
      enriched: 0,
      unreachable: 0,
      manual: 0,
      suppressed: 0,
    };

    const leads = await LeadModel.find({ status: 'discovered' })
      .sort({ 'intent.signalScore': -1, createdAt: 1 })
      .limit(limit);

    for (const lead of leads) {
      stats.processed += 1;

      try {
        await enrichOne(lead, stats);
      } catch (error) {
        logger.warn({ error, leadId: lead.id }, 'Enrichment failed for lead');
        lead.enrichmentError = error instanceof Error ? error.message : 'Unknown error';
        stats.unreachable += 1;
        await finish(lead, 'unreachable', 'enrichment threw');
      }
    }

    logger.info({ stats }, 'Enrichment run complete');
    return stats;
  },
};
