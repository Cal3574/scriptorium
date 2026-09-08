import { createTestAuthority } from './rsa-jwt';

function decodeClaims(header: {
  Authorization: string;
}): Record<string, unknown> {
  const token = header.Authorization.replace(/^Bearer /, '');
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

describe('createTestAuthority.authHeaderFor', () => {
  const auth = createTestAuthority();
  const user = { clerkUserId: 'user_alice', email: 'alice@example.com' };

  it('emits a plain signed-in token when no options are passed', () => {
    const claims = decodeClaims(auth.authHeaderFor(user));
    expect(claims.sub).toBe('user_alice');
    expect(claims.email).toBe('alice@example.com');
    expect(claims.azp).toBe('http://localhost:4200');
    expect(claims).not.toHaveProperty('pla');
    expect(claims).not.toHaveProperty('fea');
    expect(claims).not.toHaveProperty('sts');
    expect(claims).not.toHaveProperty('v');
  });

  it('scopes the plan slug into a `pla` claim and adds real-token shape claims', () => {
    const claims = decodeClaims(auth.authHeaderFor(user, { plan: 'pro' }));
    expect(claims.pla).toBe('u:pro');
    expect(claims.sts).toBe('active');
    expect(claims.v).toBe(2);
    expect(claims).not.toHaveProperty('fea');
  });

  it('scopes each feature into a comma-separated `fea` claim', () => {
    const claims = decodeClaims(
      auth.authHeaderFor(user, { plan: 'free', features: ['seats', 'export'] }),
    );
    expect(claims.fea).toBe('u:seats,u:export');
  });

  it('omits `fea` for an empty feature list', () => {
    const claims = decodeClaims(auth.authHeaderFor(user, { features: [] }));
    expect(claims).not.toHaveProperty('fea');
  });
});
