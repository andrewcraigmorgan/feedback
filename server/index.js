import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHmac } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { dispatchConnectors, listConnectors } from './connectors/index.js';
import * as zohoOAuth from './oauth/zoho.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SHOTS_DIR = path.join(DATA_DIR, 'screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

// R2 client — used when R2_ACCESS_KEY_ID is set. Falls back to local disk if not.
const r2 = process.env.R2_ACCESS_KEY_ID ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;
const R2_BUCKET     = process.env.R2_BUCKET     ?? 'mtcos';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

async function storeScreenshot(id, buf) {
  if (r2) {
    const key = `feedback/screenshots/${id}.png`;
    await r2.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         key,
      Body:        buf,
      ContentType: 'image/png',
    }));
    return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : null;
  }
  // Local fallback
  const fname = `${id}.png`;
  fs.writeFileSync(path.join(SHOTS_DIR, fname), buf);
  return fname; // relative path used by local serving endpoint
}

const db = new Database(path.join(DATA_DIR, 'feedback.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    url TEXT,
    user_agent TEXT,
    viewport TEXT,
    reporter TEXT,
    project TEXT,
    screenshot_path TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
  CREATE TABLE IF NOT EXISTS projects (
    key TEXT PRIMARY KEY,
    name TEXT,
    allowed_domains TEXT NOT NULL DEFAULT '[]',
    connectors TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL,
    connector TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deliveries_report ON deliveries(report_id);
`);

// Add `connectors` column to projects table for installs created before it was added.
try { db.prepare("SELECT connectors FROM projects LIMIT 1").get(); }
catch { db.exec("ALTER TABLE projects ADD COLUMN connectors TEXT NOT NULL DEFAULT '[]'"); }

// Bootstrap a default project on first run (no domain restrictions, dev-friendly).
if (!db.prepare('SELECT 1 FROM projects WHERE key = ?').get('default')) {
  db.prepare('INSERT INTO projects (key, name, allowed_domains, created_at) VALUES (?, ?, ?, ?)')
    .run('default', 'Default', '[]', Date.now());
}

function originHost(origin) {
  if (!origin) return null;
  try { return new URL(origin).hostname.toLowerCase(); } catch { return null; }
}

function domainAllowed(host, patterns) {
  if (!patterns || patterns.length === 0) return true; // empty allowlist = allow any
  if (!host) return false;
  return patterns.some((p) => {
    p = String(p).trim().toLowerCase();
    if (!p) return false;
    if (p === host) return true;
    if (p === 'localhost' && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return true;
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return host === base || host.endsWith('.' + base);
    }
    return false;
  });
}

function getProject(key) {
  const row = db.prepare('SELECT key, name, allowed_domains, connectors FROM projects WHERE key = ?').get(key);
  if (!row) return null;
  let domains = [], connectors = [];
  try { domains = JSON.parse(row.allowed_domains || '[]'); } catch {}
  try { connectors = JSON.parse(row.connectors || '[]'); } catch {}
  return { key: row.key, name: row.name, domains, connectors };
}

const ADMIN_TOKEN = process.env.FEEDBACK_ADMIN_TOKEN || null;
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next(); // unset = open (dev). Set in production.
  const auth = req.headers.authorization || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  if (tok === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'admin token required' });
}

const app = express();
app.use(express.json({ limit: '12mb' }));

// Public read paths (widget script, vendor assets) get a wide-open CORS so a
// <script> tag from any origin can load them. The ingest endpoint below
// applies its own per-project origin check.
app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.path === '/widget.js' || req.path.startsWith('/widget/vendor')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
});

function applyIngestCors(req, res, project) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser caller (curl, server-to-server) — allow
  const host = originHost(origin);
  if (!domainAllowed(host, project.domains)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

app.options('/api/feedback', (req, res) => {
  // We don't know the project at preflight time (can't read body), so echo the
  // origin if it matches *any* project. This avoids leaking the project list:
  // the actual POST will still be rejected if the origin doesn't match.
  const origin = req.headers.origin;
  const host = originHost(origin);
  if (origin && host) {
    const allProjects = db.prepare('SELECT allowed_domains FROM projects').all();
    const ok = allProjects.some((p) => {
      try { return domainAllowed(host, JSON.parse(p.allowed_domains || '[]')); } catch { return false; }
    });
    if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.status(204).end();
});

app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(ROOT, 'widget', 'feedback.js'));
});

app.use('/widget/vendor', express.static(path.join(ROOT, 'widget', 'vendor'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
}));

app.post('/api/feedback', async (req, res) => {
  const { kind, message, url, userAgent, viewport, reporter, project, screenshot } = req.body || {};
  if (!kind || !message) return res.status(400).json({ error: 'kind and message required' });
  if (!['bug', 'feature'].includes(kind)) return res.status(400).json({ error: 'invalid kind' });

  const projKey = project || 'default';
  const proj = getProject(projKey);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  if (!applyIngestCors(req, res, proj)) {
    return res.status(403).json({ error: 'origin not allowed for this project' });
  }

  const id = crypto.randomUUID();
  let shotPath = null;
  if (typeof screenshot === 'string' && screenshot.startsWith('data:image/png;base64,')) {
    const b64 = screenshot.slice('data:image/png;base64,'.length);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length <= 8 * 1024 * 1024) {
      shotPath = await storeScreenshot(id, buf);
    }
  }

  const now = Date.now();
  const record = {
    id, created_at: now, kind,
    message: String(message).slice(0, 10000),
    url: url ? String(url).slice(0, 2000) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    viewport: viewport ? String(viewport).slice(0, 50) : null,
    reporter: reporter ? String(reporter).slice(0, 200) : null,
    project: projKey,
    screenshot_path: shotPath,
  };
  db.prepare(`
    INSERT INTO reports (id, created_at, kind, message, url, user_agent, viewport, reporter, project, screenshot_path)
    VALUES (@id, @created_at, @kind, @message, @url, @user_agent, @viewport, @reporter, @project, @screenshot_path)
  `).run(record);

  // Fire connectors async — don't block the response on slow third parties.
  const screenshotAbs = shotPath ? path.join(SHOTS_DIR, shotPath) : null;
  dispatchConnectors(proj.connectors, record, { screenshotPath: screenshotAbs })
    .then((results) => {
      const stmt = db.prepare('INSERT INTO deliveries (report_id, connector, status, detail, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const r of results) stmt.run(id, r.connector, r.status, r.detail || null, Date.now());
    })
    .catch((err) => console.error('connector dispatch error', err));

  res.json({ ok: true, id });
});

app.get('/api/reports', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, created_at, kind, message, url, reporter, project, screenshot_path FROM reports ORDER BY created_at DESC LIMIT 500').all();
  res.json(rows);
});

app.get('/api/reports/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const deliveries = db.prepare('SELECT connector, status, detail, created_at FROM deliveries WHERE report_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ ...row, deliveries });
});

app.get('/api/projects', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.key, p.name, p.allowed_domains, p.connectors, p.created_at,
           (SELECT COUNT(*) FROM reports r WHERE r.project = p.key) AS report_count,
           (SELECT MAX(created_at) FROM reports r WHERE r.project = p.key) AS last_report_at
      FROM projects p
     ORDER BY p.created_at
  `).all();
  res.json(rows.map((r) => ({
    key: r.key,
    name: r.name,
    allowed_domains: safeJson(r.allowed_domains, []),
    connectors: safeJson(r.connectors, []).map(redactConnector),
    created_at: r.created_at,
    report_count: r.report_count,
    last_report_at: r.last_report_at,
  })));
});

app.get('/api/projects/:key', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT key, name, allowed_domains, connectors, created_at FROM projects WHERE key = ?').get(req.params.key);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({
    key: r.key,
    name: r.name,
    allowed_domains: safeJson(r.allowed_domains, []),
    connectors: safeJson(r.connectors, []).map(redactConnector),
    created_at: r.created_at,
  });
});

app.post('/api/projects', requireAdmin, (req, res) => {
  const { key, name, allowed_domains, connectors } = req.body || {};
  if (!key || !/^[a-z0-9_-]{1,64}$/i.test(key)) return res.status(400).json({ error: 'invalid key' });
  if (db.prepare('SELECT 1 FROM projects WHERE key = ?').get(key)) return res.status(409).json({ error: 'project exists' });
  db.prepare('INSERT INTO projects (key, name, allowed_domains, connectors, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(key, name || key, JSON.stringify(allowed_domains || []), JSON.stringify(connectors || []), Date.now());
  res.json({ ok: true });
});

app.patch('/api/projects/:key', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT key, connectors FROM projects WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { name, allowed_domains, connectors } = req.body || {};
  const updates = [], values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (allowed_domains !== undefined) { updates.push('allowed_domains = ?'); values.push(JSON.stringify(allowed_domains)); }
  if (connectors !== undefined) {
    // Preserve secret fields when admin sends back redacted values (e.g. "***").
    const prev = safeJson(existing.connectors, []);
    const merged = mergeConnectorSecrets(prev, connectors);
    updates.push('connectors = ?'); values.push(JSON.stringify(merged));
  }
  if (!updates.length) return res.json({ ok: true });
  values.push(req.params.key);
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE key = ?`).run(...values);
  res.json({ ok: true });
});

app.get('/api/connector-types', requireAdmin, (req, res) => {
  const types = listConnectors().map((t) => {
    if (t.type === 'zoho-projects') {
      return { ...t, customUI: 'zoho-projects', oauthAvailable: zohoOAuth.isConfigured() };
    }
    return t;
  });
  res.json(types);
});

// ---- Zoho OAuth + listing endpoints (admin) ----
const zohoStates = zohoOAuth.makeStateStore(db);
setInterval(() => zohoStates.sweep(), 60 * 60 * 1000).unref();

function readConnector(projectKey, idx) {
  const proj = getProject(projectKey);
  if (!proj) throw Object.assign(new Error('project not found'), { status: 404 });
  const c = proj.connectors[idx];
  if (!c) throw Object.assign(new Error('connector slot not found'), { status: 404 });
  return { proj, connector: c };
}

function writeConnector(projectKey, idx, mutator) {
  const row = db.prepare('SELECT connectors FROM projects WHERE key = ?').get(projectKey);
  if (!row) throw new Error('project not found');
  const conns = safeJson(row.connectors, []);
  const c = conns[idx];
  if (!c) throw new Error('connector slot not found');
  mutator(c);
  db.prepare('UPDATE projects SET connectors = ? WHERE key = ?').run(JSON.stringify(conns), projectKey);
}

// Admin token-bearing convenience: accept the token via ?token= so a redirect
// from Zoho's consent screen carries the admin's session forward.
function adminFromQueryOrHeader(req) {
  return req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token;
}

app.get('/admin/api/oauth/zoho/start', (req, res) => {
  if (ADMIN_TOKEN && adminFromQueryOrHeader(req) !== ADMIN_TOKEN) return res.status(401).send('admin token required');
  if (!zohoOAuth.isConfigured()) return res.status(400).send('FEEDBACK_ZOHO_CLIENT_ID / FEEDBACK_ZOHO_CLIENT_SECRET not set on the server');
  const { project, idx, dataCenter = 'com' } = req.query;
  if (!project || idx == null) return res.status(400).send('project and idx required');
  if (!getProject(project)) return res.status(404).send('project not found');
  const state = zohoStates.create({
    project, idx: Number(idx), dataCenter,
    adminToken: ADMIN_TOKEN ? adminFromQueryOrHeader(req) : null,
  });
  res.redirect(zohoOAuth.buildAuthorizeUrl(req, { dataCenter, state }));
});

app.get('/admin/api/oauth/zoho/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const payload = state ? zohoStates.consume(String(state)) : null;
  function back(qs) {
    const tok = payload?.adminToken ? `&token=${encodeURIComponent(payload.adminToken)}` : '';
    res.redirect(`/admin/#/projects?${qs}${tok}&project=${encodeURIComponent(payload?.project || '')}`);
  }
  if (error) return back(`zoho_error=${encodeURIComponent(String(error))}`);
  if (!payload) return res.status(400).send('invalid or expired state — try Connect again');
  if (!code) return back('zoho_error=no_code');
  try {
    const { refreshToken } = await zohoOAuth.exchangeCode(req, { code: String(code), dataCenter: payload.dataCenter });
    writeConnector(payload.project, payload.idx, (c) => {
      c.config = c.config || {};
      c.config.dataCenter = payload.dataCenter;
      c.config.refreshToken = refreshToken;
      // Stash a "connected at" timestamp so the UI can render status.
      c.config._connectedAt = Date.now();
    });
    back('zoho_connected=1');
  } catch (err) {
    console.error('zoho callback', err);
    back(`zoho_error=${encodeURIComponent(err.message || 'exchange_failed')}`);
  }
});

app.post('/api/connectors/zoho/disconnect', requireAdmin, (req, res) => {
  const { project, idx } = req.body || {};
  try {
    writeConnector(project, Number(idx), (c) => {
      if (c.config) {
        delete c.config.refreshToken;
        delete c.config._connectedAt;
      }
    });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function zohoCredsForConnector(c) {
  const { clientId, clientSecret } = zohoOAuth.clientCreds();
  return {
    refreshToken: c.config?.refreshToken,
    dataCenter: c.config?.dataCenter || 'com',
    clientId, clientSecret,
  };
}

app.get('/api/connectors/zoho/portals', requireAdmin, async (req, res) => {
  try {
    const { connector } = readConnector(String(req.query.project), Number(req.query.idx));
    if (!connector.config?.refreshToken) return res.status(400).json({ error: 'not connected' });
    res.json(await zohoOAuth.listPortals(zohoCredsForConnector(connector)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/connectors/zoho/projects', requireAdmin, async (req, res) => {
  try {
    const { connector } = readConnector(String(req.query.project), Number(req.query.idx));
    if (!connector.config?.refreshToken) return res.status(400).json({ error: 'not connected' });
    res.json(await zohoOAuth.listProjects(zohoCredsForConnector(connector), String(req.query.portalId)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/connectors/zoho/tasklists', requireAdmin, async (req, res) => {
  try {
    const { connector } = readConnector(String(req.query.project), Number(req.query.idx));
    if (!connector.config?.refreshToken) return res.status(400).json({ error: 'not connected' });
    res.json(await zohoOAuth.listTasklists(zohoCredsForConnector(connector), String(req.query.portalId), String(req.query.projectId)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.delete('/api/projects/:key', requireAdmin, (req, res) => {
  if (req.params.key === 'default') return res.status(400).json({ error: 'cannot delete default project' });
  db.prepare('DELETE FROM projects WHERE key = ?').run(req.params.key);
  res.json({ ok: true });
});

function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

const SECRET_FIELDS = ['refreshToken', 'clientSecret', 'accessToken', 'smtpPass', 'apiKey', 'token'];
function redactConnector(c) {
  const out = { ...c, config: { ...(c.config || {}) } };
  for (const f of SECRET_FIELDS) if (out.config[f]) out.config[f] = '***';
  return out;
}
function mergeConnectorSecrets(prev, next) {
  return next.map((nc, i) => {
    const out = { ...nc, config: { ...(nc.config || {}) } };
    const pc = prev[i];
    if (pc && pc.type === nc.type) {
      for (const f of SECRET_FIELDS) {
        if (out.config[f] === '***' && pc.config && pc.config[f]) out.config[f] = pc.config[f];
      }
    }
    return out;
  });
}

app.get('/screenshots/:file', requireAdmin, (req, res) => {
  const f = req.params.file;
  if (!/^[a-f0-9-]+\.png$/.test(f)) return res.status(400).end();
  res.sendFile(path.join(SHOTS_DIR, f));
});

// Public screenshot endpoint — keyed by report ID, verified against the
// same FEEDBACK_WEBHOOK_SECRET so only the mtcOS API (which knows the secret)
// can build a valid token. Token = first 16 hex chars of HMAC(secret, reportId).
// The connector puts this URL in the webhook payload; the API uses it to link
// or embed the screenshot without exposing the admin token.
app.get('/api/reports/:id/screenshot', (req, res) => {
  const secret = process.env.FEEDBACK_MTCOS_WEBHOOK_SECRET;
  if (!secret) return res.status(404).end();

  const { token } = req.query;
  const expected = createHmac('sha256', secret).update(req.params.id).digest('hex').slice(0, 16);
  if (!token || token !== expected) return res.status(401).end();

  const row = db.prepare('SELECT screenshot_path FROM reports WHERE id = ?').get(req.params.id);
  if (!row || !row.screenshot_path) return res.status(404).end();

  const f = path.basename(row.screenshot_path);
  if (!/^[a-f0-9-]+\.png$/.test(f)) return res.status(400).end();
  res.sendFile(path.join(SHOTS_DIR, f));
});

app.use('/admin', express.static(path.join(ROOT, 'admin')));
app.use('/demo', express.static(path.join(ROOT, 'demo')));

app.get('/', (req, res) => res.redirect('/admin/'));

// Port scrambler: this box runs other Docker services, so 3000 is often taken.
// `PORT=…` pins explicitly. Otherwise we try `PREFERRED_PORT` (default 3000),
// then pick a deterministic-but-randomised port from the ephemeral range,
// retrying on EADDRINUSE up to MAX_TRIES times.
const PORT_FILE = path.join(DATA_DIR, 'port');
const MAX_TRIES = 30;

function pickRandomPort() {
  // 49152–65535 is IANA's dynamic/private range; safer than 10000–49151
  // where Docker's host-published ports tend to land.
  return 49152 + crypto.randomInt(0, 65535 - 49152 + 1);
}

function readLastPort() {
  try {
    const n = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : null;
  } catch { return null; }
}

function startServer(attempt = 0, lastErr = null) {
  if (attempt >= MAX_TRIES) {
    console.error('could not bind a free port after', MAX_TRIES, 'attempts:', lastErr && lastErr.message);
    process.exit(1);
  }
  let port;
  if (process.env.PORT) {
    port = Number(process.env.PORT);
  } else if (attempt === 0) {
    // Sticky: reuse the port we successfully bound to last time, so embed
    // snippets and the Zoho OAuth redirect URI keep working across restarts.
    const last = readLastPort();
    port = last || Number(process.env.PREFERRED_PORT) || 3000;
  } else if (attempt === 1) {
    // First fallback: try PREFERRED_PORT (or 3000) if we haven't already.
    const fallback = Number(process.env.PREFERRED_PORT) || 3000;
    const last = readLastPort();
    port = (fallback !== last) ? fallback : pickRandomPort();
  } else {
    port = pickRandomPort();
  }

  const server = app.listen(port, () => {
    const actual = server.address().port;
    fs.writeFileSync(PORT_FILE, String(actual));
    const base = `http://localhost:${actual}`;
    const note = attempt > 0 ? '  (scrambled — preferred port was busy)' : '';
    console.log('');
    console.log(`  feedback server  →  ${base}${note}`);
    console.log(`  admin            →  ${base}/admin/`);
    console.log(`  demo             →  ${base}/demo/`);
    console.log(`  widget           →  ${base}/widget.js`);
    console.log(`  port saved to    →  ${path.relative(ROOT, PORT_FILE)}`);
    if (!ADMIN_TOKEN) console.log(`  (FEEDBACK_ADMIN_TOKEN unset — admin endpoints are open)`);
    console.log('');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (process.env.PORT) {
        console.error(`PORT=${port} is in use; refusing to scramble because PORT was set explicitly`);
        process.exit(1);
      }
      startServer(attempt + 1, err);
    } else {
      console.error('server error:', err);
      process.exit(1);
    }
  });
}

startServer();
