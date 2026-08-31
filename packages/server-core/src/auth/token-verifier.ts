import { verifyToken } from '@clerk/backend';

// The identity a verified session token yields. `sub` is the Clerk user id;
// `email` comes from a Clerk JWT-template claim (the deployment must expose it)
// and is refreshed onto the local row on every request.
export interface VerifiedToken {
  sub: string;
  email: string;
}

// Seam for token verification so the guard can be unit-tested without minting
// real tokens. The live binding wraps `@clerk/backend` `verifyToken`.
export abstract class TokenVerifier {
  abstract verify(token: string): Promise<VerifiedToken>;
}

export interface ClerkTokenVerifierConfig {
  // PEM public key for networkless RSA verification (`CLERK_JWT_KEY`).
  jwtKey: string;
  // Allowlist of origins checked against the token `azp` claim.
  authorizedParties: string[];
}

export class ClerkTokenVerifier extends TokenVerifier {
  constructor(private readonly config: ClerkTokenVerifierConfig) {
    super();
  }

  async verify(token: string): Promise<VerifiedToken> {
    // Networkless: `jwtKey` present -> RSA-verify against the PEM, no JWKS
    // fetch. Throws `TokenVerificationError` on a bad signature, `exp`/`nbf`,
    // or an `azp` outside `authorizedParties`.
    const payload = await verifyToken(token, {
      jwtKey: this.config.jwtKey,
      authorizedParties: this.config.authorizedParties,
    });

    const sub = payload.sub;
    const email = (payload as { email?: unknown }).email;
    if (typeof sub !== 'string' || typeof email !== 'string') {
      throw new Error('token is missing the sub or email claim');
    }
    return { sub, email };
  }
}
