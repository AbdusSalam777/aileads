import { Router } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { logger } from '../../shared/logger.js';
import { LeadModel } from '../leads/lead.model.js';
import { cancelPendingMessages } from '../leads/lead.service.js';
import { suppressionService } from './suppression.service.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

export const unsubscribeRouter = Router();

const page = (title: string, message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f6f7f9;
         color: #1a1d23; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; padding: 1.5rem; }
  main { background: #fff; border: 1px solid #e4e6eb; border-radius: 12px; padding: 2rem;
         max-width: 32rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0; line-height: 1.6; color: #4a5160; }
</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;

/**
 * Public and unauthenticated by design: a recipient must be able to opt out from
 * their mail client without an account. The signed token is the only credential.
 */
unsubscribeRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const payload = verifyUnsubscribeToken(req.params.token);

    if (!payload) {
      res
        .status(400)
        .type('html')
        .send(
          page(
            'This link is not valid',
            'We could not verify this unsubscribe link. Please reply to the email directly and we will remove you straight away.',
          ),
        );
      return;
    }

    await suppressionService.add({
      type: 'email',
      value: payload.email,
      reason: 'unsubscribed',
      note: 'Unsubscribe link clicked',
      leadId: payload.leadId,
    });

    const lead = await LeadModel.findById(payload.leadId);

    if (lead) {
      lead.statusHistory.push({
        from: lead.status,
        to: 'unsubscribed',
        reason: 'unsubscribe link clicked',
        at: new Date(),
      });
      lead.status = 'unsubscribed';
      lead.nextFollowUpAt = null;
      await lead.save();
      await cancelPendingMessages(lead._id, 'lead unsubscribed');
    }

    logger.info({ leadId: payload.leadId }, 'Unsubscribe processed');

    res
      .status(200)
      .type('html')
      .send(
        page(
          'You have been unsubscribed',
          'You will not receive any further emails from us. Sorry for the interruption.',
        ),
      );
  }),
);
