# Feedback

Self-hosted Userback replacement. Embeddable widget with bug-report / feature-request flows and a built-in screen snipping tool, plus a backend that collects reports, enforces per-project domain auth, and forwards to connectors (Zoho Projects, email, more later).

No CDNs — `html2canvas` is vendored locally at `widget/vendor/`.

## Run

```bash
npm install
npm start                                   # dev (admin endpoints open)
FEEDBACK_ADMIN_TOKEN=$(openssl rand -hex 16) npm start   # production (admin needs Bearer token)
```

- Demo page: http://localhost:3000/demo/
- Admin: http://localhost:3000/admin/
- Widget: `<script src="http://localhost:3000/widget.js" data-project="my-site" defer></script>`

When `FEEDBACK_ADMIN_TOKEN` is set, paste it into the admin top-right field; it's stored in `localStorage` and sent as `Authorization: Bearer <token>` (and as `?token=…` for screenshot images so `<img>` tags work).

## Embed options

| attribute | default | purpose |
|-----------|---------|---------|
| `data-endpoint` | same origin as `widget.js`/`api/feedback`  | POST target |
| `data-vendor`   | same origin as `widget.js`/`widget/vendor` | where `html2canvas.min.js` lives |
| `data-project`  | `default`            | project key (must exist server-side)        |
| `data-accent`   | `#1f2937`            | accent colour                               |
| `data-position` | `bottom-right`       | `bottom-right` / `bottom-left` / `top-right` / `top-left` |

## Domain-based auth

Every feedback POST is checked against the project's `allowed_domains` allowlist. The browser's `Origin` header host must match one of:

- exact: `app.example.com`
- wildcard subdomain: `*.example.com` (also matches `example.com`)
- `localhost` (also matches `127.0.0.1`, `::1`)

An empty allowlist allows any origin (useful for dev and the bundled `default` project). Configure per project in the admin **Projects** tab. Server-to-server calls (no `Origin` header) are always allowed.

## Connectors

After a report is saved, configured connectors fire asynchronously. Outcomes are recorded in the `deliveries` table and shown in the report detail view.

Built in:

- **Zoho Projects** — creates a task per report, with the screenshot attached. Needs OAuth refresh-token flow: register a Self Client at https://api-console.zoho.com with scope `ZohoProjects.tasks.CREATE`, then provide `clientId`, `clientSecret`, `refreshToken`, plus `dataCenter` (`com`/`eu`/`in`/…), `portalId`, `projectId` (and optionally `tasklistId`, `priority`).
- **Email (SMTP)** — sends a HTML email with the screenshot attached. Uses `nodemailer`. Needs `smtpHost`, `from`, `to`; auth and TLS are optional.

Each connector instance can be limited to certain feedback kinds (`bug`, `feature`).

### Adding a connector

1. Create `server/connectors/<name>.js` exporting `{ type, label, fields, send(report, config, ctx) }`. `fields` describes the admin form; mark secrets with `secret: true`.
2. Register it in `server/connectors/index.js`.

Secret fields are returned as `***` from `GET /api/projects` and preserved across saves.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/api/feedback`            | origin allowlist | `{ kind, message, project, reporter?, url?, userAgent?, viewport?, screenshot? }`, `kind` ∈ `bug` `feature` |
| `GET`  | `/api/reports`             | admin            | latest 500 |
| `GET`  | `/api/reports/:id`         | admin            | full row + connector deliveries |
| `GET`  | `/api/projects`            | admin            | list (secrets redacted) |
| `POST` | `/api/projects`            | admin            | `{ key, name?, allowed_domains?, connectors? }` |
| `PATCH`| `/api/projects/:key`       | admin            | partial update; pass `***` to keep an existing secret |
| `DELETE`| `/api/projects/:key`      | admin            | (cannot delete `default`) |
| `GET`  | `/api/connector-types`     | admin            | metadata for admin UI |
| `GET`  | `/screenshots/:file`       | admin            | PNG bytes |

## Storage

SQLite at `data/feedback.db`, screenshots in `data/screenshots/`. To reset, delete `data/`.
