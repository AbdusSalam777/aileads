import bcrypt from 'bcryptjs';
import { connectMongo, disconnectMongo } from '../config/mongodb.js';
import { CampaignModel } from '../features/campaigns/campaign.model.js';
import { UserModel } from '../features/auth/user.model.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'DemoPassword123!';

const run = async () => {
  await connectMongo();

  let user = await UserModel.findOne({ email: DEMO_EMAIL });

  if (!user) {
    user = await UserModel.create({
      name: 'Demo Operator',
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      role: 'admin',
    });
    console.log(`Created demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    console.log(`Reusing demo user ${DEMO_EMAIL}`);
  }

  let campaign = await CampaignModel.findOne({ ownerId: user._id, name: 'Freelance web + video' });

  if (!campaign) {
    campaign = await CampaignModel.create({
      ownerId: user._id,
      name: 'Freelance web + video',
      status: 'active',
      services: ['web development', 'full stack development', 'video editing'],
      offer:
        'I build and rebuild fast, mobile-friendly websites for small businesses and agencies, and I edit short-form promotional video.',
      icp: 'Small businesses, agencies and founders who need a site built or rebuilt, or who need regular video editing.',
      sender: {
        name: 'Demo Operator',
        email: DEMO_EMAIL,
        title: 'Freelance developer and video editor',
        physicalAddress: '123 Example Street, Manchester, M1 1AA, United Kingdom',
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
    console.log(`Created campaign "${campaign.name}" (${campaign.id})`);
  } else {
    console.log(`Reusing campaign "${campaign.name}" (${campaign.id})`);
  }

  await disconnectMongo();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectMongo();
  process.exit(1);
});
