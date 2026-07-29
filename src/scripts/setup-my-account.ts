/**
 * One-off setup for a real (non-demo) account: gives the signed-up user their
 * own campaign so discovery has something to attach leads to.
 *
 *   npm run setup:me --workspace backend -- you@example.com
 *
 * Deliberately leaves `sender.physicalAddress` empty — it is a legal
 * requirement on cold email and must be the operator's real address, so the
 * campaign cannot be activated until they fill it in from Settings.
 */
import { connectMongo, disconnectMongo } from '../config/mongodb.js';
import { CampaignModel } from '../features/campaigns/campaign.model.js';
import { UserModel } from '../features/auth/user.model.js';

const CAMPAIGN_NAME = 'Freelance web + video';

const run = async () => {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: npm run setup:me --workspace backend -- you@example.com');
    process.exit(1);
  }

  await connectMongo();

  const user = await UserModel.findOne({ email, deletedAt: null });

  if (!user) {
    console.error(`No account found for ${email}. Register in the app first, then re-run this.`);
    await disconnectMongo();
    process.exit(1);
  }

  const existing = await CampaignModel.findOne({ ownerId: user._id });

  if (existing) {
    console.log(`${email} already has campaign "${existing.name}" (${existing.id}) — nothing to do.`);
    await disconnectMongo();
    return;
  }

  const campaign = await CampaignModel.create({
    ownerId: user._id,
    name: CAMPAIGN_NAME,
    // Starts paused: outreach only begins once the postal address is filled in
    // and the operator explicitly activates it.
    status: 'paused',
    services: ['web development', 'full stack development', 'video editing'],
    offer:
      'I build and rebuild fast, mobile-friendly websites for small businesses and agencies, and I edit short-form promotional video.',
    icp: 'Small businesses, agencies and founders who need a site built or rebuilt, or who need regular video editing.',
    sender: {
      name: user.name,
      email: user.email,
      title: 'Freelance developer and video editor',
      physicalAddress: '',
    },
    intentEnabled: true,
    intentSources: ['hn', 'remoteok', 'wwr'],
    intentKeywords: ['shopify', 'webflow', 'landing page', 'youtube'],
    osmEnabled: true,
    osmTargeting: {
      areas: ['Manchester'],
      categories: ['restaurant', 'hairdresser', 'dentist'],
    },
    minScoreToDraft: 60,
    dailyLeadTarget: 40,
  });

  console.log(`Created campaign "${campaign.name}" (${campaign.id}) for ${email}`);
  console.log('Next: add your postal address in Settings, then activate the campaign.');

  await disconnectMongo();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectMongo();
  process.exit(1);
});
