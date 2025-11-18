/**
 * Utility for making authenticated requests to Cloud Run services
 * using service identity (ID tokens)
 */

import { GoogleAuth } from 'google-auth-library';
import type { IdTokenClient } from 'google-auth-library';

const googleAuth = new GoogleAuth();
const idTokenClients = new Map<string, IdTokenClient>();

/**
 * Fetch with service identity authentication for Cloud Run services
 * 
 * This function generates an ID token for the target Cloud Run service
 * and includes it in the Authorization header. This is required for
 * calling private Cloud Run services from other Cloud Functions.
 * 
 * @param url - The full URL to call (including query parameters)
 * @param init - Fetch RequestInit options (method, headers, body, etc.)
 * @param audienceOverride - Optional override for the audience (defaults to URL without query params)
 * @returns Promise<Response> - The fetch response
 */
export async function fetchWithServiceIdentity(
  url: string,
  init: RequestInit = {},
  audienceOverride?: string
): Promise<Response> {
  // In emulator mode, skip authentication
  if (process.env.FUNCTIONS_EMULATOR) {
    return fetch(url, init);
  }

  const audience = sanitizeAudience(audienceOverride ?? url);

  let client = idTokenClients.get(audience);
  if (!client) {
    client = await googleAuth.getIdTokenClient(audience);
    idTokenClients.set(audience, client);
  }

  const authHeaders = await client.getRequestHeaders(audience);
  const authorization = authHeaders.get('Authorization') ?? authHeaders.get('authorization');
  if (!authorization) {
    throw new Error(`Failed to obtain Authorization header for ${audience}`);
  }

  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', authorization);

  // Preserve caller options but replace headers object
  const fetchInit: RequestInit = { ...init, headers };
  return fetch(url, fetchInit);
}

function sanitizeAudience(rawAudience: string): string {
  try {
    const parsed = new URL(rawAudience);
    // Cloud Run audiences should not include query params or fragments
    parsed.search = '';
    parsed.hash = '';
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname}`;
  } catch {
    return rawAudience.split('?')[0]?.replace(/\/+$/, '') || rawAudience;
  }
}
