import { env } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../config/mongodb.js';
import { CampaignModel } from '../features/campaigns/campaign.model.js';
import { discoveryService } from '../features/discovery/discovery.service.js';
import { draftingService } from '../features/drafting/drafting.service.js';
import { enrichmentService } from '../features/enrichment/enrichment.service.js';
import { LeadModel } from '../features/leads/lead.model.js';
import { buildMessageText } from '../features/email/message-builder.js';
import { OutreachMessageModel } from '../features/outreach/outreach-message.model.js';
import { unsubscribeUrlFor } from '../features/outreach/sender.service.js';
import { qualificationService } from '../features/qualification/qualification.service.js';

const heading = (text: string) => {
  console.log(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}`);
};

const run = async () => {
  heading('PIPELINE DRY RUN');
  console.log('Flags:', {
    PIPELINE_DRY_RUN: env.PIPELINE_DRY_RUN,
    DISCOVERY_DRY_RUN: env.DISCOVERY_DRY_RUN,
    AI_DRY_RUN: env.AI_DRY_RUN,
    EMAIL_DRY_RUN: env.EMAIL_DRY_RUN,
    OUTREACH_ENABLED: env.OUTREACH_ENABLED,
    AI_PROVIDER: env.AI_PROVIDER,
  });

  if (!env.EMAIL_DRY_RUN) {
    console.error('\nRefusing to run: EMAIL_DRY_RUN is false, so this could send real email.');
    console.error('Set PIPELINE_DRY_RUN=true (or EMAIL_DRY_RUN=true) before running this script.');
    process.exit(1);
  }

  await connectMongo();

  const campaign = await CampaignModel.findOne({ status: 'active' });

  if (!campaign) {
    console.error('No active campaign found. Run `npm run seed --workspace backend` first.');
    await disconnectMongo();
    process.exit(1);
  }

  console.log(`\nCampaign: ${campaign.name} (${campaign.id})`);

  heading('1. DISCOVERY');
  console.log(await discoveryService.runDiscovery(campaign.id));

  heading('2. ENRICHMENT');
  console.log(await enrichmentService.runEnrichment(50));

  heading('3. QUALIFICATION');
  console.log(await qualificationService.runQualification(50));

  heading('4. DRAFTING');
  console.log(await draftingService.runDrafting(50));

  heading('LEADS');
  const leads = await LeadModel.find({ campaignId: campaign._id })
    .sort({ 'ai.score': -1 })
    .limit(40)
    .lean();

  for (const lead of leads) {
    const score = lead.ai?.score ?? lead.intent?.signalScore ?? '-';
    console.log(
      `${String(lead.status).padEnd(14)} ${String(lead.source).padEnd(9)} ${String(score).padStart(3)}  ` +
        `${(lead.contactEmail ?? '(no email)').padEnd(32)} ${lead.name.slice(0, 34)}`,
    );
  }

  heading('DRAFTS AWAITING APPROVAL');
  const drafts = await OutreachMessageModel.find({ campaignId: campaign._id, status: 'draft' })
    .limit(3)
    .lean();

  console.log(`${drafts.length} shown (of the full draft queue)\n`);

  for (const draft of drafts) {
    console.log('-'.repeat(72));
    console.log(`TO:      ${draft.toEmail}`);
    console.log(`SUBJECT: ${draft.subject}`);
    console.log('-'.repeat(72));
    console.log(
      buildMessageText({
        toEmail: draft.toEmail,
        subject: draft.subject,
        body: draft.body,
        sender: campaign.sender,
        unsubscribeUrl: unsubscribeUrlFor(draft.unsubscribeToken),
      }),
    );
  }

  heading('DONE — no email was sent');
  console.log('Nothing left this machine. Approve drafts in the UI at /emails.');

  await disconnectMongo();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectMongo();
  process.exit(1);
});
