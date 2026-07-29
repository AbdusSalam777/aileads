import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { authController } from './auth.controller.js';
import { changePasswordSchema, loginSchema, registerSchema } from './auth.schemas.js';

export const authRouter = Router();

authRouter.post('/register', validateRequest(registerSchema), asyncHandler(authController.register));
authRouter.post('/login', validateRequest(loginSchema), asyncHandler(authController.login));
authRouter.post('/refresh', asyncHandler(authController.refresh));
authRouter.post('/logout', asyncHandler(authController.logout));
authRouter.get('/profile', authenticate, asyncHandler(authController.profile));
authRouter.patch(
  '/change-password',
  authenticate,
  validateRequest(changePasswordSchema),
  asyncHandler(authController.changePassword),
);
