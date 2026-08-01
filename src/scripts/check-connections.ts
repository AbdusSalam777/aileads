/**
 * Verifies external credentials without printing any secret value.
 *
 *   npm run check --workspace backend
 *
 * Safe to run at any time: it makes one tiny AI call and logs in to IMAP
 * read-only. This app has no SMTP sending capability to check any more —
 * exported leads are sent from wherever the operator pastes them.
 */
import { ImapFlow } from 'imapflow';
import { env } from '../config/env.js';
import { groqProvider } from '../features/ai/groq.provider.js';

type Check = { label: string; ok: boolean; detail: string };

const results: Check[] = [];

const record = (label: string, ok: boolean, detail: string) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} ${detail}`);
};

const checkAi = async () => {
  // Tests the key whenever one is present, even while dry run still forces the
  // stub provider — the point is to prove the credential before switching over.
  if (!env.GROQ_API_KEY) {
    if (env.AI_PROVIDER === 'ollama') {
      record('AI provider', true, 'set to "ollama" — runs locally, no key needed');
      return;
    }

    record('Groq API key', false, 'GROQ_API_KEY is empty in backend/.env');
    return;
  }

  try {
    // The provider always requests a json_object response, which the API only
    // allows when the prompt itself mentions json.
    const result = await groqProvider.chat({
      system: 'You are a connection test. Reply with json only.',
      user: 'Reply with the json object {"ok": true} and nothing else.',
      maxTokens: 20,
    });

    record('Groq API key', true, `working — model ${result.model} replied ${result.text.trim()}`);
  } catch (error) {
    record('Groq API key', false, (error as Error).message);
  }
};

const checkImap = async () => {
  if (!env.IMAP_ENABLED) {
    record('IMAP', false, 'IMAP_ENABLED is false — replies to exported leads will not be tracked');
    return;
  }

  if (!env.IMAP_USER || !env.IMAP_PASSWORD) {
    record('IMAP', false, 'IMAP_USER or IMAP_PASSWORD is empty in backend/.env');
    return;
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
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    record('IMAP', true, `inbox reachable (${mailbox.exists} messages)`);
    await client.logout();
  } catch (error) {
    record('IMAP', false, (error as Error).message);
    client.close();
  }
};

const run = async () => {
  console.log('Checking external connections.\n');

  await checkAi();
  await checkImap();

  const failed = results.filter((result) => !result.ok);
  console.log('');

  if (failed.length === 0) {
    console.log('All connections working.');
    return;
  }

  console.log(`${failed.length} of ${results.length} checks failed. Fix these before going live:`);
  for (const failure of failed) {
    console.log(`  - ${failure.label}: ${failure.detail}`);
  }
  process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
