import { verifyToken } from '@clerk/backend';
import { parsePlanClaims } from '../entitlements/plan-claims.js';

// The identity a verified session token yields. `sub` is the Clerk user id;
// `email` comes from a Clerk JWT-template claim (the deployment must expose it)
// and is refreshed onto the local row on every request. `plan` / `features`
// are parsed from the `pla` / `fea` claims with the scope prefix stripped;
// `features` is always a list, `plan` is absent when the token carries no
// `pla` claim (the entitlement guard then falls back to `free`).
export interface VerifiedToken {
  sub: string;
  email: string;
  plan?: string;
  features: string[];
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
    const { plan, features } = parsePlanClaims(
      payload as { pla?: unknown; fea?: unknown },
    );
    return { sub, email, plan, features };
  }
}
