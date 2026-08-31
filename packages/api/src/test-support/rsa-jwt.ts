import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

// The auth guard's `verifyToken` cannot tell a test-signed token from a real
// Clerk one - both are RS256 verified against a PEM public key. So the suite
// mints its own keypair once, hands the public half to the app as
// `CLERK_JWT_KEY`, and signs short-lived tokens carrying the claims the guard
// reads (`sub`, `email`, `azp`). Zero changes to the guard - and no JWT
// library, just `node:crypto`.
export interface TestAuthority {
  // SPKI PEM - pass as `CLERK_JWT_KEY`.
  jwtKey: string;
  authorizedParty: string;
  authHeaderFor(user: { clerkUserId: string; email: string }): {
    Authorization: string;
  };
  // A structurally valid RS256 token signed by a different key.
  forgedHeader(): { Authorization: string };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signRs256(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iat: now, nbf: now, exp: now + 300, ...claims }),
  );
  const data = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey);
  return `${data}.${b64url(signature)}`;
}

export function createTestAuthority(
  authorizedParty = 'http://localhost:4200',
): TestAuthority {
  const keypair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forgery = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwtKey = keypair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();

  return {
    jwtKey,
    authorizedParty,
    authHeaderFor(user) {
      const token = signRs256(keypair.privateKey, {
        sub: user.clerkUserId,
        email: user.email,
        azp: authorizedParty,
      });
      return { Authorization: `Bearer ${token}` };
    },
    forgedHeader() {
      const token = signRs256(forgery.privateKey, {
        sub: 'user_forged',
        email: 'forged@example.com',
        azp: authorizedParty,
      });
      return { Authorization: `Bearer ${token}` };
    },
  };
}
