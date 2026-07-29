import { describe, expect, it } from 'vitest';
import { isFreelancerRequest } from './hn.source.js';

describe('isFreelancerRequest', () => {
  it('accepts a client post from the monthly freelancer thread', () => {
    expect(
      isFreelancerRequest(
        'SEEKING FREELANCER | Berlin or Remote | We need a web developer to rebuild our site. Budget $5k.',
      ),
    ).toBe(true);
  });

  it('rejects a freelancer advertising themselves', () => {
    expect(
      isFreelancerRequest('SEEKING WORK | Remote | Full stack developer available for react projects.'),
    ).toBe(false);
  });

  it('rejects unrelated HN chatter that merely mentions the services', () => {
    // These are the exact kinds of posts that previously became "leads".
    expect(isFreelancerRequest('Residential Proxies Are a National Security Threat')).toBe(false);
    expect(isFreelancerRequest('Show HN: Trylle - The Next-Gen Git Platform for Modern Teams')).toBe(false);
    expect(isFreelancerRequest('I built a landing page with shopify and it went well')).toBe(false);
  });

  it('rejects dead and flagged comments', () => {
    expect(isFreelancerRequest('[dead] SEEKING FREELANCER | remote work')).toBe(false);
    expect(isFreelancerRequest('[flagged] SEEKING FREELANCER | remote work')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isFreelancerRequest('Seeking Freelancer | need a wordpress site built')).toBe(true);
  });
});
