// Zoho Projects OAuth helpers — admin-side flow.
//
// Setup (one time, by the operator):
//   1. Register a Server-based Application at https://api-console.zoho.com.
//   2. Set redirect URI to <FEEDBACK_BASE_URL>/admin/api/oauth/zoho/callback.
//   3. Export FEEDBACK_ZOHO_CLIENT_ID / FEEDBACK_ZOHO_CLIENT_SECRET.
//   4. (Optional) FEEDBACK_BASE_URL for production; otherwise we derive it
//      from the inbound request.
//
// Per-connector flow (in the admin UI):
//   • User picks a data centre, clicks Connect → /oauth/zoho/start.
//   • We redirect to Zoho consent. State is a random token bound to the
//     project key + connector slot + DC, persisted in oauth_states.
//   • Zoho redirects back to /oauth/zoho/callback with ?code=&state=.
//   • We swap the code for a refresh + access token, write the refresh token
//     into the project's connector config, and redirect the admin back.
//
// Listing helpers (portals, projects, tasklists) call the Zoho API on demand
// using the stored refresh token, so the UI can offer dropdowns instead of
// asking the user to copy IDs.

import crypto from 'node:crypto';

const SCOPES = [
  'ZohoProjects.portals.READ',
  'ZohoProjects.projects.READ',
  'ZohoProjects.tasks.CREATE',
  'ZohoProjects.tasklists.READ',
].join(',');

export function isConfigured() {
  return !!(process.env.FEEDBACK_ZOHO_CLIENT_ID && process.env.FEEDBACK_ZOHO_CLIENT_SECRET);
}

export function clientCreds() {
  return {
    clientId: process.env.FEEDBACK_ZOHO_CLIENT_ID,
    clientSecret: process.env.FEEDBACK_ZOHO_CLIENT_SECRET,
  };
}

function baseUrl(req) {
  if (process.env.FEEDBACK_BASE_URL) return process.env.FEEDBACK_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

export function redirectUri(req) {
  return `${baseUrl(req)}/admin/api/oauth/zoho/callback`;
}

export function buildAuthorizeUrl(req, { dataCenter = 'com', state }) {
  const { clientId } = clientCreds();
  const u = new URL(`https://accounts.zoho.${dataCenter}/oauth/v2/auth`);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('redirect_uri', redirectUri(req));
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(req, { code, dataCenter }) {
  const { clientId, clientSecret } = clientCreds();
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(req),
    code,
  });
  const r = await fetch(`https://accounts.zoho.${dataCenter}/oauth/v2/token`, {
    method: 'POST',
    body: params,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.refresh_token || !json.access_token) {
    throw new Error(`zoho code exchange failed: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token, expiresIn: json.expires_in };
}

export async function refreshAccessToken({ refreshToken, dataCenter }) {
  const { clientId, clientSecret } = clientCreds();
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const r = await fetch(`https://accounts.zoho.${dataCenter}/oauth/v2/token`, {
    method: 'POST',
    body: params,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) {
    throw new Error(`zoho refresh failed: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.access_token;
}

async function zohoGet(path, { accessToken, dataCenter }) {
  const r = await fetch(`https://projectsapi.zoho.${dataCenter}/restapi${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`zoho GET ${path} failed: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

export async function listPortals(creds) {
  const accessToken = await refreshAccessToken(creds);
  const json = await zohoGet('/portals/', { accessToken, dataCenter: creds.dataCenter });
  return (json.portals || []).map((p) => ({ id: String(p.id), name: p.name || p.id }));
}

export async function listProjects(creds, portalId) {
  const accessToken = await refreshAccessToken(creds);
  const json = await zohoGet(`/portal/${encodeURIComponent(portalId)}/projects/`, { accessToken, dataCenter: creds.dataCenter });
  return (json.projects || []).map((p) => ({ id: String(p.id), name: p.name || p.id }));
}

export async function listTasklists(creds, portalId, projectId) {
  const accessToken = await refreshAccessToken(creds);
  const json = await zohoGet(`/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasklists/`, { accessToken, dataCenter: creds.dataCenter });
  return (json.tasklists || []).map((t) => ({ id: String(t.id), name: t.name || t.id }));
}

// State management — short-lived nonces tying an OAuth round-trip back to a
// specific project + connector slot. Stored in SQLite so they survive a quick
// restart but auto-expire after 10 minutes.

export function makeStateStore(db) {
  return {
    create(payload) {
      const state = crypto.randomBytes(16).toString('hex');
      db.prepare('INSERT INTO oauth_states (state, payload, expires_at) VALUES (?, ?, ?)')
        .run(state, JSON.stringify(payload), Date.now() + 10 * 60 * 1000);
      return state;
    },
    consume(state) {
      const row = db.prepare('SELECT payload, expires_at FROM oauth_states WHERE state = ?').get(state);
      if (!row) return null;
      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
      if (row.expires_at < Date.now()) return null;
      try { return JSON.parse(row.payload); } catch { return null; }
    },
    sweep() {
      db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
    },
  };
}
