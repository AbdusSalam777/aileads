import { decodeEntities, stripHtml } from '../../shared/text.js';

/** Lines that mark the start of the quoted email being replied to. */
const QUOTE_MARKERS = [
  /^on .+ wrote:$/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^_{5,}$/,
  /^from:\s/i,
  /^sent from my /i,
  /^>+/,
];

/**
 * Reply bodies arrive with the entire prior thread appended. Only the part the
 * person actually typed is worth storing, so everything from the first quote
 * marker onwards is dropped.
 */
export const stripQuotedText = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (QUOTE_MARKERS.some((marker) => marker.test(line.trim()))) {
      break;
    }

    kept.push(line);
  }

  return kept.join('\n').trim();
};

/**
 * Pulls the readable text out of a raw RFC822 message. Deliberately simple:
 * this only has to produce a preview snippet, not reconstruct the message.
 */
export const extractReplyText = (raw: string, maxLength = 1200): string => {
  // Split headers from body at the first blank line.
  const separatorIndex = raw.search(/\r?\n\r?\n/);
  const body = separatorIndex === -1 ? raw : raw.slice(separatorIndex).trim();

  // Prefer a plain-text part when the message is multipart.
  const plainPart = body.match(
    /content-type:\s*text\/plain[\s\S]*?(?:\r?\n\r?\n)([\s\S]*?)(?=\r?\n--|\r?\n?content-type:|$)/i,
  );

  const chosen = plainPart?.[1] ?? body;
  const text = decodeEntities(stripHtml(chosen))
    .replace(/=\r?\n/g, '') // quoted-printable soft line breaks
    .replace(/=3D/gi, '=');

  // `[^\S\r\n]` is horizontal whitespace of any kind, which also catches the
  // non-breaking spaces a decoded &nbsp; leaves behind. stripHtml additionally
  // pads tag boundaries, which would otherwise read as "good , call me".
  const tidied = text
    .replace(/[^\S\r\n]+([,.;:!?])/g, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ');

  const meaningful = stripQuotedText(tidied)
    .split(/\r?\n/)
    .filter((line) => !/^--\s*$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return meaningful.length > maxLength ? `${meaningful.slice(0, maxLength).trim()}…` : meaningful;
};
