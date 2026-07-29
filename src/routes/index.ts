import { Router } from 'express';
import { analyticsRouter } from '../features/analytics/analytics.routes.js';
import { authRouter } from '../features/auth/auth.routes.js';
import { campaignRouter } from '../features/campaigns/campaign.routes.js';
import { complianceRouter } from '../features/compliance/compliance.routes.js';
import { discoveryRouter } from '../features/discovery/discovery.routes.js';
import { enrichmentRouter } from '../features/enrichment/enrichment.routes.js';
import { healthRouter } from '../features/health/health.routes.js';
import { jobsRouter } from '../features/jobs/jobs.routes.js';
import { leadRouter } from '../features/leads/lead.routes.js';
import { outreachRouter } from '../features/outreach/outreach.routes.js';
import { pipelineRouter } from '../features/pipeline/pipeline.routes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/campaigns', campaignRouter);
apiRouter.use('/leads', leadRouter);
apiRouter.use('/discovery', discoveryRouter);
apiRouter.use('/enrichment', enrichmentRouter);
apiRouter.use('/pipeline', pipelineRouter);
apiRouter.use('/outreach', outreachRouter);
apiRouter.use('/compliance', complianceRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/analytics', analyticsRouter);
