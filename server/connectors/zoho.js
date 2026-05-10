// Zoho Projects connector — creates a task per feedback report.
//
// Auth: OAuth refresh-token flow. Generate a refresh token once via Zoho's
// Self Client (https://api-console.zoho.com) with scope `ZohoProjects.tasks.CREATE`.
// We exchange the refresh token for a short-lived access token at send time.
//
// Endpoints differ by data centre — accounts.zoho.{com,eu,in,...} and
// projectsapi.zoho.{...}. The `dataCenter` config field selects this.

import fs from 'node:fs';

const DC_DEFAULT = 'com';

async function getAccessToken({ refreshToken, clientId, clientSecret, dataCenter = DC_DEFAULT }) {
  // Fall back to globally-configured Zoho app credentials if the per-connector
  // ones aren't set (the OAuth flow in admin uses the global ones).
  clientId = clientId || process.env.FEEDBACK_ZOHO_CLIENT_ID;
  clientSecret = clientSecret || process.env.FEEDBACK_ZOHO_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) throw new Error('missing OAuth credentials');
  const url = `https://accounts.zoho.${dataCenter}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const r = await fetch(url, { method: 'POST', body });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) {
    throw new Error(`zoho token refresh failed: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.access_token;
}

function buildDescription(report) {
  const lines = [
    report.message,
    '',
    '---',
    `Type: ${report.kind}`,
    report.url ? `URL: ${report.url}` : null,
    report.reporter ? `Reporter: ${report.reporter}` : null,
    report.viewport ? `Viewport: ${report.viewport}` : null,
    report.user_agent ? `UA: ${report.user_agent}` : null,
    `Submitted: ${new Date(report.created_at).toISOString()}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function send(report, config, ctx) {
  const { portalId, projectId, dataCenter = DC_DEFAULT } = config;
  if (!portalId || !projectId) throw new Error('portalId and projectId required');

  const token = await getAccessToken(config);
  const headers = { Authorization: `Zoho-oauthtoken ${token}` };
  const base = `https://projectsapi.zoho.${dataCenter}/restapi/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}`;

  const titlePrefix = report.kind === 'bug' ? '[Bug] ' : '[Feature] ';
  const name = (titlePrefix + report.message.split('\n')[0]).slice(0, 250);
  const description = buildDescription(report);

  const form = new URLSearchParams({ name, description });
  if (config.tasklistId) form.set('tasklist_id', String(config.tasklistId));
  if (config.priority) form.set('priority', String(config.priority));

  const r = await fetch(`${base}/tasks/`, { method: 'POST', headers, body: form });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`zoho task create ${r.status}: ${JSON.stringify(json).slice(0, 200)}`);

  const taskId = json && json.tasks && json.tasks[0] && json.tasks[0].id;

  // Attach screenshot if present and we got a task id back.
  if (taskId && ctx && ctx.screenshotPath && fs.existsSync(ctx.screenshotPath)) {
    try {
      const buf = fs.readFileSync(ctx.screenshotPath);
      const fd = new FormData();
      fd.append('uploadfile', new Blob([buf], { type: 'image/png' }), 'screenshot.png');
      const ar = await fetch(`${base}/tasks/${taskId}/uploadfile/`, { method: 'POST', headers, body: fd });
      if (!ar.ok) {
        const txt = await ar.text();
        return `task ${taskId} created; attachment failed ${ar.status}: ${txt.slice(0, 100)}`;
      }
    } catch (err) {
      return `task ${taskId} created; attachment error: ${err.message}`;
    }
  }
  return taskId ? `task ${taskId}` : 'task created';
}

export default {
  type: 'zoho-projects',
  label: 'Zoho Projects (task)',
  fields: [
    { key: 'dataCenter',   label: 'Data centre', type: 'text', placeholder: 'com / eu / in / com.au', required: true },
    { key: 'clientId',     label: 'Client ID',     type: 'text',     required: true },
    { key: 'clientSecret', label: 'Client secret', type: 'password', required: true, secret: true },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true, secret: true },
    { key: 'portalId',     label: 'Portal ID',     type: 'text', required: true },
    { key: 'projectId',    label: 'Project ID',    type: 'text', required: true },
    { key: 'tasklistId',   label: 'Tasklist ID (optional)', type: 'text' },
    { key: 'priority',     label: 'Priority (optional)',    type: 'text', placeholder: 'None / Low / Medium / High' },
  ],
  send,
};
