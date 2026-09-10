/**
 * Cloudflare Worker: Warcraft Logs token broker for Pepega Check.
 *
 * Holds the guild's WCL client credentials server-side and hands the app a
 * bearer token, so nothing secret ever ships in the static bundle and
 * teammates need zero setup.
 *
 * Deploy (once, free tier is plenty):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker,
 *      paste this file, deploy.
 *   2. Worker → Settings → Variables and Secrets:
 *        WCL_CLIENT_ID     (secret)  – from https://www.warcraftlogs.com/api/clients
 *        WCL_CLIENT_SECRET (secret)
 *        ALLOWED_ORIGINS   (text)    – e.g. "https://<user>.github.io"
 *   3. Put the worker URL into public/app-config.json as "tokenUrl".
 *
 * Note: the Origin check keeps other websites from using the broker in a
 * browser, but anyone who finds the URL can curl it. The token only grants
 * read access to public Warcraft Logs data (the same thing a free personal
 * API client gives), so the realistic worst case is someone spending your
 * API rate limit.
 */

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';

/** In-isolate cache so we do not hammer the WCL token endpoint. */
let cachedToken = null;
let cachedUntil = 0;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const originOk = allowed.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!originOk) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    const now = Date.now();
    if (!cachedToken || now > cachedUntil - 3600_000) {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!response.ok) {
        return new Response('Token exchange failed', { status: 502, headers: corsHeaders });
      }
      const body = await response.json();
      cachedToken = body.access_token;
      cachedUntil = now + body.expires_in * 1000;
    }

    return new Response(
      JSON.stringify({
        access_token: cachedToken,
        expires_in: Math.floor((cachedUntil - now) / 1000),
      }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  },
};
