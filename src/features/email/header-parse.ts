/**
 * imapflow returns requested headers as a raw RFC822 byte buffer, not a Map.
 * Calling .get() on it throws "headers?.get is not a function" — which silently
 * failed every reply poll until it was caught.
 */
export const parseRawHeaders = (raw: Buffer | string | undefined): Map<string, string> => {
  const headers = new Map<string, string>();

  if (!raw) {
    return headers;
  }

  const text = typeof raw === 'string' ? raw : raw.toString('utf8');

  // Unfold first: a header value may continue on following lines that begin
  // with whitespace, and splitting naively would lose the remainder.
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');

  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    // Keep the first occurrence; later duplicates are not more authoritative.
    if (name && !headers.has(name)) {
      headers.set(name, value);
    }
  }

  return headers;
};
