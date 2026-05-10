// Email (SMTP) connector — sends each report as an email.
//
// Uses nodemailer if available. Configure SMTP host/port/user/pass plus a
// `to` address. Multiple recipients allowed (comma-separated).

import fs from 'node:fs';
import path from 'node:path';

let nodemailer = null;
async function load() {
  if (nodemailer) return nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('nodemailer not installed — run `npm install nodemailer`'); }
  return nodemailer;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function send(report, config, ctx) {
  const { smtpHost, smtpPort = 587, smtpUser, smtpPass, secure, from, to } = config;
  if (!smtpHost || !from || !to) throw new Error('smtpHost, from, to required');

  const nm = await load();
  const transport = nm.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: !!secure,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  const subject = `[${report.kind === 'bug' ? 'Bug' : 'Feature'}] ${report.message.split('\n')[0].slice(0, 120)}`;
  const text = [
    report.message,
    '',
    `Type: ${report.kind}`,
    report.url ? `URL: ${report.url}` : null,
    report.reporter ? `Reporter: ${report.reporter}` : null,
    report.viewport ? `Viewport: ${report.viewport}` : null,
    report.user_agent ? `UA: ${report.user_agent}` : null,
    `Submitted: ${new Date(report.created_at).toISOString()}`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>
      <pre style="white-space:pre-wrap;background:#f5f5f7;padding:12px;border-radius:6px;font-family:inherit">${escapeHtml(report.message)}</pre>
      <table style="font-size:13px;border-collapse:collapse;margin-top:12px">
        ${report.url ? `<tr><td style="color:#666;padding:2px 12px 2px 0">URL</td><td><a href="${escapeHtml(report.url)}">${escapeHtml(report.url)}</a></td></tr>` : ''}
        ${report.reporter ? `<tr><td style="color:#666;padding:2px 12px 2px 0">Reporter</td><td>${escapeHtml(report.reporter)}</td></tr>` : ''}
        ${report.viewport ? `<tr><td style="color:#666;padding:2px 12px 2px 0">Viewport</td><td>${escapeHtml(report.viewport)}</td></tr>` : ''}
        ${report.user_agent ? `<tr><td style="color:#666;padding:2px 12px 2px 0">UA</td><td>${escapeHtml(report.user_agent)}</td></tr>` : ''}
      </table>
    </div>`;

  const attachments = [];
  if (ctx && ctx.screenshotPath && fs.existsSync(ctx.screenshotPath)) {
    attachments.push({ filename: 'screenshot.png', path: ctx.screenshotPath, contentType: 'image/png' });
  }

  const info = await transport.sendMail({ from, to, replyTo: report.reporter || undefined, subject, text, html, attachments });
  return info && info.messageId ? `messageId ${info.messageId}` : 'sent';
}

export default {
  type: 'email',
  label: 'Email (SMTP)',
  fields: [
    { key: 'smtpHost', label: 'SMTP host',     type: 'text',     required: true },
    { key: 'smtpPort', label: 'SMTP port',     type: 'text',     placeholder: '587' },
    { key: 'secure',   label: 'TLS (port 465)', type: 'checkbox' },
    { key: 'smtpUser', label: 'SMTP user',     type: 'text' },
    { key: 'smtpPass', label: 'SMTP password', type: 'password', secret: true },
    { key: 'from',     label: 'From address',  type: 'text',     required: true, placeholder: 'feedback@example.com' },
    { key: 'to',       label: 'To address(es)', type: 'text',    required: true, placeholder: 'a@x.com, b@y.com' },
  ],
  send,
};
