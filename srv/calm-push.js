'use strict';
/*
 * Pushes the backend's warning/error log records to SAP Cloud ALM via the
 * SAP Cloud ALM Raw Data Inbound Logs API (POST /api/calm-logs/v1/logs, OpenTelemetry logs JSON).
 *
 * Why: on a BTP *trial* subaccount Cloud ALM cannot discover the app automatically, so the app is
 * registered manually in Cloud ALM Landscape Management and the logs are pushed to that service (serviceId = its LMS ID).
 *
 * Flow:  cds.log(...).warn/error  ->  buffer  ->  every N seconds  ->  destination (OAuth2 client credentials)
 *        ->  POST <Cloud ALM>/api/calm-logs/v1/logs?useCase=exm.im&serviceId=<LMS ID>  ->  IEM -> Exceptions
 *
 * Settings (mta.yaml -> ro-order-srv -> properties):
 *   SAP_CALM_PUSH_ENABLED      true/false                       (default false)
 *   SAP_CALM_PUSH_SERVICE_ID   LMS ID of the service in Cloud ALM (mandatory)
 *   SAP_CALM_PUSH_DESTINATION  BTP destination to Cloud ALM API  (default CALM_datacollector)
 *   SAP_CALM_PUSH_USE_CASE     exm.im                           (default; IEM exceptions)
 *   SAP_CALM_PUSH_DEV          true = synchronous dev mode with error details, max 100 calls / 24h (default false)
 *   SAP_CALM_PUSH_LEVEL        error | warn                     (default warn = warnings + errors)
 *   SAP_CALM_PUSH_INTERVAL     flush interval in seconds        (default 60, 900 in dev mode)
 *   SAP_CALM_PUSH_APP_NAME     service.name sent to Cloud ALM   (default SAP_CALM_SERVICE_NAME or ro-order-srv)
 */
const cds = require('@sap/cds');
const util = require('util');

const LOG = cds.log('calm-push');
const env = process.env;

const ENABLED = /^true$/i.test(env.SAP_CALM_PUSH_ENABLED || '');
const SERVICE_ID = env.SAP_CALM_PUSH_SERVICE_ID;
const DESTINATION = env.SAP_CALM_PUSH_DESTINATION || 'CALM_datacollector';
const USE_CASE = env.SAP_CALM_PUSH_USE_CASE || 'exm.im';
const DEV = /^true$/i.test(env.SAP_CALM_PUSH_DEV || '');
const MAX_LEVEL = (env.SAP_CALM_PUSH_LEVEL || 'warn').toLowerCase() === 'error' ? 1 : 2; // cds.log: 1 error, 2 warn
const INTERVAL_S = Number(env.SAP_CALM_PUSH_INTERVAL) || (DEV ? 900 : 60); // dev mode: 100 calls / 24h
const APP_NAME = env.SAP_CALM_PUSH_APP_NAME || env.SAP_CALM_SERVICE_NAME || 'ro-order-srv';

const MAX_BUFFER = 5000;   // API limit: 5000 log records per request
const CHUNK = 200;         // keep each request well below the 1 MB JSON payload limit
const MAX_TEXT = 8000;     // cut very long messages / stack traces
// 'calm-push'/'telemetry': never push our own logs (no loops); 'error': CAP's generic request-error line,
// already pushed with more context by the OrderService error handler (srv/order-service.js) -> no duplicates
const SKIP_LOGGERS = new Set(['calm-push', 'telemetry', 'error']);

const buffer = [];
let dropped = 0;
let timer;

const cut = s => (s && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + ' ...[truncated]' : s);
const str = (key, value) => ({ key, value: { stringValue: String(value) } });

function toRecord(module, level, args) {
  const err = args.find(a => a instanceof Error);
  const message = args
    .map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : util.inspect(a, { depth: 3, breakLength: Infinity })))
    .join(' ');
  const ctx = cds.context;
  const now = `${Date.now()}000000`;
  const attributes = [str('sap.exm.user', (ctx && ctx.user && ctx.user.id) || 'ANONYMOUS'), str('logger', module)];
  if (ctx && ctx.id) attributes.push(str('correlation.id', ctx.id));
  if (err) {
    attributes.push(str('exception.type', err.code ? `${err.name} (${err.code})` : err.name || 'Error'));
    attributes.push(str('exception.message', cut(err.message)));
    if (err.stack) attributes.push(str('exception.stacktrace', cut(err.stack)));
  }
  return {
    module,
    record: {
      timeUnixNano: now,
      observedTimeUnixNano: now,
      severityNumber: level === 1 ? 'SEVERITY_NUMBER_ERROR' : 'SEVERITY_NUMBER_WARN',
      severityText: level === 1 ? 'Error' : 'Warning',
      body: { stringValue: cut(message) },
      attributes
    }
  };
}

function capture(module, level, args) {
  if (level > MAX_LEVEL || SKIP_LOGGERS.has(module)) return;
  try {
    if (buffer.length >= MAX_BUFFER) { buffer.shift(); dropped++; }
    buffer.push(toRecord(module, level, args));
  } catch (e) {
    /* never break the app because of monitoring */
  }
}

function payload(items) {
  const byLogger = new Map();
  for (const { module, record } of items) {
    if (!byLogger.has(module)) byLogger.set(module, []);
    byLogger.get(module).push(record);
  }
  return {
    resourceLogs: [{
      resource: { attributes: [str('service.name', APP_NAME)] },
      scopeLogs: [...byLogger].map(([name, logRecords]) => ({ scope: { name }, logRecords }))
    }]
  };
}

async function post(items) {
  const { getDestination } = require('@sap-cloud-sdk/connectivity');
  const dest = await getDestination({ destinationName: DESTINATION });
  if (!dest || !dest.url) throw new Error(`destination ${DESTINATION} not found`);
  const headers = { 'content-type': 'application/json' };
  const token = dest.authTokens && dest.authTokens.find(t => !t.error);
  if (token) headers.authorization = token.http_header ? token.http_header.value : `${token.type} ${token.value}`;
  else if (dest.authentication && dest.authentication !== 'NoAuthentication') {
    const reason = (dest.authTokens && dest.authTokens[0] && dest.authTokens[0].error) || 'no token returned';
    throw new Error(`no OAuth token for destination ${DESTINATION}: ${reason}`);
  }

  // destination URL may be "https://<tenant>.<region>.alm.cloud.sap" or ".../api"
  const base = dest.url.replace(/\/+$/, '').replace(/\/api$/, '');
  const q = new URLSearchParams({ useCase: USE_CASE, serviceId: SERVICE_ID, version: 'v1', tag: APP_NAME, dev: String(DEV) });
  const res = await fetch(`${base}/api/calm-logs/v1/logs?${q}`, { method: 'POST', headers, body: JSON.stringify(payload(items)) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw Object.assign(new Error(`Cloud ALM answered HTTP ${res.status}: ${text.slice(0, 500)}`), { status: res.status });
  return { status: res.status, text };
}

let flushing = false;
async function flush() {
  if (flushing || !buffer.length) return;
  flushing = true;
  try {
    while (buffer.length) {
      const items = buffer.splice(0, CHUNK);
      try {
        const r = await post(items);
        LOG.info(`pushed ${items.length} log record(s) to SAP Cloud ALM (HTTP ${r.status})${DEV && r.text ? ': ' + r.text.slice(0, 300) : ''}`);
      } catch (e) {
        if (e.status === 429 || e.status >= 500 || !e.status) buffer.unshift(...items); // retry later
        LOG.warn(`push to SAP Cloud ALM failed, ${e.status === 429 || e.status >= 500 || !e.status ? 'will retry' : 'records dropped'}: ${e.message}`);
        break;
      }
    }
    if (dropped) { LOG.warn(`${dropped} log record(s) dropped (buffer full)`); dropped = 0; }
  } finally {
    flushing = false;
  }
}

function install() {
  if (!ENABLED) return LOG.info('SAP Cloud ALM log push disabled (SAP_CALM_PUSH_ENABLED != true)');
  if (!SERVICE_ID) return LOG.warn('SAP Cloud ALM log push disabled: SAP_CALM_PUSH_SERVICE_ID (LMS ID of the service in Cloud ALM) is not set');

  // hook into cds.log: wrap the format function (also used by @cap-js/telemetry) and re-apply it to existing loggers
  const _format = cds.log.format;
  const format = (cds.log.format = function (module, level, ...args) {
    capture(module, level, args);
    return _format.call(this, module, level, ...args);
  });
  for (const each in cds.log.loggers) cds.log.loggers[each].setFormat(format);

  timer = setInterval(flush, INTERVAL_S * 1000);
  timer.unref();
  cds.on('shutdown', () => flush()); // push what is left when CF stops/restarts the app
  LOG.info(`SAP Cloud ALM log push active: ${MAX_LEVEL === 1 ? 'errors' : 'warnings + errors'} -> destination ${DESTINATION}, useCase=${USE_CASE}, serviceId=${SERVICE_ID}, every ${INTERVAL_S}s${DEV ? ' (dev mode)' : ''}`);
}

// install after @cap-js/telemetry (which hooks in on 'served' as well)
cds.on('served', install);

module.exports = { flush, _payload: payload };
