// Connector registry. Each connector module exports:
//   { type: string, label: string, fields: [{ key, label, type, required, secret }],
//     send(report, config, ctx) -> Promise<void> }
//
// `report` matches the row inserted into the `reports` table.
// `ctx.screenshotPath` is an absolute path to the PNG (or null).
//
// Add new connectors by importing and registering them below.

import zoho from './zoho.js';
import email from './email.js';
import mtcos from './mtcos.js';

const REGISTRY = new Map();
function register(c) { REGISTRY.set(c.type, c); }
register(zoho);
register(email);
register(mtcos);

export function listConnectors() {
  return [...REGISTRY.values()].map(({ type, label, fields }) => ({ type, label, fields }));
}

export async function dispatchConnectors(connectors, report, ctx) {
  if (!Array.isArray(connectors) || connectors.length === 0) return [];
  const results = await Promise.all(
    connectors.map(async ({ type, config, kinds }) => {
      try {
        if (Array.isArray(kinds) && kinds.length && !kinds.includes(report.kind)) {
          return { connector: type, status: 'skipped', detail: 'kind filter' };
        }
        const c = REGISTRY.get(type);
        if (!c) return { connector: type, status: 'error', detail: 'unknown connector type' };
        const detail = await c.send(report, config || {}, ctx || {});
        return { connector: type, status: 'sent', detail: detail || null };
      } catch (err) {
        return { connector: type, status: 'error', detail: String(err && err.message || err).slice(0, 500) };
      }
    })
  );
  return results;
}
