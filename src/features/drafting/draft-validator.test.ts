import { describe, expect, it } from 'vitest';
import { hasBlockingIssue, validateDraft } from './draft-validator.js';

const goodBody = `Hi,

I came across Corner Cut Barbers and noticed the site does not resize properly on a
phone, which is where most people will be looking you up from. I build and rebuild
small business websites, and I also edit short promo video.

If it is useful I can send over two or three specific things I would change, with no
obligation at all.

Would that be worth a look?

Best`;

const goodDraft = { subject: 'quick note about your website', body: goodBody };

describe('validateDraft', () => {
  it('accepts a well-formed draft', () => {
    const issues = validateDraft(goodDraft);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('blocks a subject faking a reply', () => {
    for (const subject of ['Re: our chat', 'RE: proposal', 'Fwd: this', 'fw: hello']) {
      const issues = validateDraft({ ...goodDraft, subject });
      expect(issues.some((i) => i.code === 'SUBJECT_FAKE_REPLY')).toBe(true);
      expect(hasBlockingIssue(issues)).toBe(true);
    }
  });

  it('blocks empty or overlong subjects', () => {
    expect(hasBlockingIssue(validateDraft({ ...goodDraft, subject: '' }))).toBe(true);
    expect(hasBlockingIssue(validateDraft({ ...goodDraft, subject: 'x'.repeat(120) }))).toBe(true);
  });

  it('blocks bodies that are too short or too long', () => {
    expect(hasBlockingIssue(validateDraft({ ...goodDraft, body: 'Hi there. Interested?' }))).toBe(
      true,
    );
    expect(
      hasBlockingIssue(validateDraft({ ...goodDraft, body: `${'word '.repeat(300)}?` })),
    ).toBe(true);
  });

  it('blocks unfilled placeholders', () => {
    for (const body of [
      goodBody.replace('Corner Cut Barbers', '[COMPANY NAME]'),
      goodBody.replace('Corner Cut Barbers', '{{company}}'),
      `${goodBody}\nTODO: add case study`,
      goodBody.replace('Corner Cut Barbers', 'YOUR_COMPANY'),
    ]) {
      const issues = validateDraft({ ...goodDraft, body });
      expect(issues.some((i) => i.code === 'PLACEHOLDER_LEFT')).toBe(true);
    }
  });

  it('blocks model self-references and preambles', () => {
    for (const body of [
      `As an AI language model, I think ${goodBody}`,
      `Here's the draft email you asked for:\n\n${goodBody}`,
      `\`\`\`\n${goodBody}\n\`\`\``,
    ]) {
      const issues = validateDraft({ ...goodDraft, body });
      expect(issues.some((i) => i.code === 'AI_LEAK')).toBe(true);
      expect(hasBlockingIssue(issues)).toBe(true);
    }
  });

  it('blocks fabricated prior relationships', () => {
    for (const body of [
      goodBody.replace('I came across', 'As we discussed, I came across'),
      goodBody.replace('I came across', 'We spoke last week and I came across'),
      goodBody.replace('I came across', 'I have been a customer of yours and came across'),
      goodBody.replace('I came across', 'Per our call, I came across'),
    ]) {
      const issues = validateDraft({ ...goodDraft, body });
      expect(issues.some((i) => i.code === 'DISHONEST_CLAIM')).toBe(true);
      expect(hasBlockingIssue(issues)).toBe(true);
    }
  });

  it('warns but does not block on a self-written unsubscribe line', () => {
    const issues = validateDraft({ ...goodDraft, body: `${goodBody}\n\nUnsubscribe here.` });

    expect(issues.some((i) => i.code === 'DUPLICATE_UNSUBSCRIBE')).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('warns on HTML and on a missing question', () => {
    const html = validateDraft({ ...goodDraft, body: `${goodBody}<p>hi</p>` });
    expect(html.some((i) => i.code === 'HTML_IN_BODY')).toBe(true);

    const noQuestion = validateDraft({ ...goodDraft, body: goodBody.replace(/\?/g, '.') });
    expect(noQuestion.some((i) => i.code === 'NO_QUESTION')).toBe(true);
    expect(hasBlockingIssue(noQuestion)).toBe(false);
  });

  it('reports every independent problem at once', () => {
    const issues = validateDraft({ subject: 'Re: [COMPANY]', body: 'too short' });
    const codes = issues.map((i) => i.code);

    expect(codes).toContain('SUBJECT_FAKE_REPLY');
    expect(codes).toContain('BODY_TOO_SHORT');
    expect(codes).toContain('PLACEHOLDER_LEFT');
  });
});

describe('generic subject rejection', () => {
  const valid = {
    subject: "Khandoker's curry club page",
    body: 'Hi,\n\nI build websites for small restaurants. I saw your curry club runs every Thursday but the page is hard to read on a phone. Would a quick look be useful?\n\nBest,',
  };

  it('rejects a subject that would fit any recipient', () => {
    // Groq produced exactly this for three different businesses.
    const issues = validateDraft({ ...valid, subject: 'website update' });

    expect(issues.some((i) => i.code === 'SUBJECT_TOO_GENERIC')).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('ignores case and trailing punctuation when matching', () => {
    expect(validateDraft({ ...valid, subject: 'Quick Question?' }).some((i) => i.code === 'SUBJECT_TOO_GENERIC')).toBe(true);
  });

  it('accepts a subject naming the business', () => {
    expect(validateDraft(valid).some((i) => i.code === 'SUBJECT_TOO_GENERIC')).toBe(false);
  });

  it('accepts a specific subject that merely contains a generic word', () => {
    const issues = validateDraft({ ...valid, subject: 'the Y Club booking form on mobile' });

    expect(issues.some((i) => i.code === 'SUBJECT_TOO_GENERIC')).toBe(false);
  });
});
