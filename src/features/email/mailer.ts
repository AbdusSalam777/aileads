import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

let transporter: Transporter | undefined;

/**
 * In dry-run mode nodemailer's streamTransport builds a real MIME message and
 * hands it back instead of connecting to SMTP — nothing can leave the machine.
 */
export const getTransport = (): Transporter => {
  if (transporter) {
    return transporter;
  }

  if (env.EMAIL_DRY_RUN) {
    logger.info('Mailer running in DRY RUN mode: messages are built but never sent');
    transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    return transporter;
  }

  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error('SMTP_USER and SMTP_PASSWORD are required to send real email');
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });

  return transporter;
};

export const verifyTransport = async (): Promise<{ ok: boolean; error?: string }> => {
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

export const resetTransport = () => {
  transporter = undefined;
};
