// mtcOS Projects connector — creates a project via a signed webhook.
//
// No API token stored here. The feedback server signs each payload with
// HMAC-SHA256 using a shared secret; the mtcOS API validates the signature
// and creates the project. Generate the secret once on both sides:
//   openssl rand -hex 32
//
// mtcOS API setup:
//   .env → FEEDBACK_WEBHOOK_SECRET=<same secret>
//   Endpoint: POST /api/public/webhook/feedback

import { createHmac } from 'node:crypto';

function sign(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Screenshot token: first 16 hex chars of HMAC(secret, reportId).
// Matches the server-side check in index.js so the mtcOS API can fetch
// the screenshot without needing the full admin token.
function screenshotToken(secret, reportId) {
  return createHmac('sha256', secret).update(reportId).digest('hex').slice(0, 16);
}

function buildPayload(report, config, secret) {
  const { projectId, taskListId, feedbackServerUrl } = config;
  const serverUrl = (feedbackServerUrl || '').replace(/\/$/, '');
  const hasShot   = serverUrl && report.id && report.screenshot_path;
  return {
    kind:         report.kind,
    message:      report.message,
    projectId,
    taskListId:   taskListId || undefined,
    url:          report.url        || undefined,
    reporter:     report.reporter   || undefined,
    viewport:     report.viewport   || undefined,
    user_agent:   report.user_agent || undefined,
    submitted_at: new Date(report.created_at).toISOString(),
    screenshot_url: hasShot
      ? `${serverUrl}/api/reports/${report.id}/screenshot?token=${screenshotToken(secret, report.id)}`
      : undefined,
  };
}

async function send(report, config, _ctx) {
  const webhookUrl = config.webhookUrl || process.env.FEEDBACK_MTCOS_WEBHOOK_URL;
  const secret     = config.webhookSecret || process.env.FEEDBACK_MTCOS_WEBHOOK_SECRET;
  const serverUrl  = config.feedbackServerUrl || process.env.FEEDBACK_PUBLIC_URL || '';

  if (!webhookUrl) throw new Error('webhookUrl is required');
  if (!secret)     throw new Error('webhookSecret is required');

  const payload = buildPayload(report, { ...config, feedbackServerUrl: serverUrl }, secret);
  // Remove undefined keys so the JSON stays clean.
  const body = JSON.stringify(
    Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
  );

  const r = await fetch(webhookUrl, {
    method:  'POST',
    headers: {
      'Content-Type':        'application/json',
      'X-Feedback-Signature': sign(body, secret),
    },
    body,
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`webhook ${r.status}: ${JSON.stringify(json).slice(0, 200)}`);

  return json.id ? `project ${json.id}` : 'project created';
}

export default {
  type:  'mtcos-projects',
  label: 'mtcOS Projects (webhook)',
  fields: [
    {
      key:         'webhookUrl',
      label:       'Webhook URL',
      type:        'text',
      required:    true,
      placeholder: 'https://api.mtcos.mtcserver.com/api/public/webhook/feedback',
    },
    {
      key:      'webhookSecret',
      label:    'Webhook secret',
      type:     'password',
      required: true,
      secret:   true,
    },
    {
      key:         'projectId',
      label:       'Project ID',
      type:        'text',
      required:    true,
      placeholder: 'MTC-12345',
    },
    {
      key:         'taskListId',
      label:       'Snagging list ID (leave blank to auto-create)',
      type:        'text',
      placeholder: 'MTC-12345-snagging',
    },
    {
      key:         'feedbackServerUrl',
      label:       'Feedback server public URL (for screenshot links)',
      type:        'text',
      placeholder: 'https://feedback.os.mtc.co.uk',
    },
  ],
  send,
};
