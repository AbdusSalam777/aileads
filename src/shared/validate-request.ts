import type { RequestHandler } from 'express';
import type { AnyZodObject, ZodEffects } from 'zod';

type RequestSchema = AnyZodObject | ZodEffects<AnyZodObject>;

export const validateRequest =
  (schema: RequestSchema): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      next(result.error);
      return;
    }

    req.body = result.data.body ?? req.body;
    req.query = result.data.query ?? req.query;
    req.params = result.data.params ?? req.params;
    next();
  };
