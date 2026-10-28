# ro-order-fullstack

Full-stack sales order app for **SAP BTP Cloud Foundry**: **SAPUI5 front end + CAP Node.js backend + SAP Application Router**, packaged as one MTA.
It runs on a **trial account**: no SAP HANA, no XSUAA, no paid services.

```
Browser (SAPUI5 app)  ──►  ro-order-app (approuter, Node.js)  ──/odata──►  ro-order-srv (CAP Node.js, OData V4)
  products, order form,       serves webapp/, forwards               Products, Orders, submitOrder, syncToS4
  orders list                 /odata/* to destination srv-api        in-memory SQLite (demo data reloads at start)
```

## Modules

| Module | Path | What it does |
|---|---|---|
| `ro-order-srv` | `gen/srv` (built from `db/`, `srv/`, `server.js`) | CAP OData V4 service `/odata/v4/orders` |
| `ro-order-app` | `app/router` | Approuter + UI5 app (`webapp/index.html`, `webapp/app.js`) |

## Build & deploy

```bash
mbt build                                           # -> mta_archives/ro-order-fullstack_1.0.0.mtar
cf deploy mta_archives/ro-order-fullstack_1.0.0.mtar  # or deploy the MTAR via ReleaseOwl
```

Open the **ro-order-app** route, e.g. `https://<org>-<space>-ro-order-app.cfapps.us10-001.hana.ondemand.com`.

## What you can do in the UI (and what it produces in the backend logs)

Each event is logged **once** at the right level: business rejections = `warn`, technical failures = `error` with stack trace.

| # | Action in UI (Place Order) | Result | Backend log |
|---|---|---|---|
| 1 | Cloudfulcrum Pvt Ltd (C-1001), HT-1000, qty 2, PO `PO-CLOUDFULCRUM-2026-1045` | Order `SO-xxxxxxxx` created | info |
| 2 | Click **Place Order** again with the same PO (double click / interface resend) | **409 Duplicate purchase order** – real SQL error `SQLITE_CONSTRAINT_UNIQUE`, stock update rolled back | **error + stack trace** |
| 3 | HT-1010, qty 5 (only 3 in stock) / HT-1068 (stock 0) | **409 Out of stock** | warn |
| 4 | SAP CPI (C-1004, limit 5,000 EUR), HT-1010, qty 3 = 5,997 EUR | **409 Credit limit exceeded** | warn |
| 5 | SAP BTP (C-1002) | **403 Customer blocked** (overdue invoices) | warn |
| 6 | HT-1001 Notebook Basic 17 | **410 Product discontinued**, successor HT-1000 | warn |
| 7 | HT-1063 Keyboard, qty 15 (pack size 10) | **400 Invalid quantity** | warn |
| 8 | HT-9992 Monitor, qty 25 (max 20 per order) | **400 Quantity too high** | warn |
| 9 | HT-1010, qty 1 (stock drops below reorder level 5) | Order created | info + **warn** "Low stock" |
| 10 | **Sync to S/4HANA** | **500** "Connection to S/4HANA backend failed: ECONNREFUSED" | **error + stack trace** |
| 11 | **Simulate Null Pointer** | **500** TypeError | **error + stack trace** |

Technical errors show a **Reference** ID in the popup (`x-correlation-id`), which is logged with every record (`correlation.id` in Cloud ALM).
If the backend app is stopped (BTP trial stops apps daily), the UI says "order service is not reachable" instead of a raw HTTP 404 -> `cf start ro-order-srv`.

The error scenarios are intentional, so there is real runtime data for monitoring (e.g. SAP Cloud ALM Integration & Exception Monitoring).

## SAP Cloud ALM (runtime logs + Exception Monitoring)

The backend follows SAP's supported setup (SAP Cloud ALM Expert Portal -> OpenTelemetry@SAP -> Auto-instrumentation for Node.js,
variant "Custom-built applications using CDS library"). Every `cds.log` record of `ro-order-srv` (info / warn / error, incl. the
framework loggers `cds`, `odata`) is handed to the SAP Cloud ALM agent, which sends it to SAP Cloud ALM.

```
cds.log('order-service').error(...)  ->  @cap-js/telemetry (logging)  ->  ExmLogProcessor (@sap/xotel-agent-ext-js)  ->  destination CALM_datacollector  ->  SAP Cloud ALM
```

| Piece | Where |
|---|---|
| SAP Cloud ALM agent `@sap/xotel-agent-ext-js` 2.0.5 (from SAP's repository) | `package.json` dependencies, `.npmrc` (copied to `gen/srv` at build) |
| Agent preloaded with `NODE_ARGS: -r @sap/xotel-agent-ext-js`, start script `node ${NODE_ARGS} ./node_modules/.bin/cds-serve` | `mta.yaml` (ro-order-srv), `package.json` scripts |
| `@cap-js/telemetry` logging -> processor `ExmLogProcessor`, exporter `OTLPLogExporter` (grpc) | `package.json` -> `cds.requires.telemetry.logging` |
| `@cap-js/telemetry` own tracing/metrics exporters switched off (the agent already sends traces/metrics) | `package.json` -> `tracing.exporter: null`, `metrics.exporter: null` |
| JSON log format in production (required for log export) | `package.json` -> `cds.log.[production].format: json` |
| Errors logged with `cds.log`; 5xx errors pass the Error object -> `exception.message` / `exception.stacktrace` | `srv/order-service.js` |
| `SAP_CALM_SERVICE_NAME` / `SAP_CALM_SERVICE_TYPE: SAP_CP_CF` / `SAP_CALM_LOGS_ENABLED: true` | `mta.yaml` (ro-order-srv) |
| Destination service binding, so the agent finds the subaccount destination `CALM_datacollector` | `mta.yaml` (resource `ro-order-destination`) |

**To activate in SAP Cloud ALM:** build & deploy, then in Cloud ALM open the monitoring app (e.g. Integration & Exception Monitoring)
-> Configuration -> switch the service `ro-order-srv` (SAP BTP, Cloud Foundry environment) ON for the use case.
Then trigger traffic in the UI (Place Order for HT-1068 -> 409, Sync to S/4HANA -> 500).

**Troubleshooting:** `SAP_CALM_DCI_LOG_LEVEL=debug` (agent log), `OTEL_LOG_LEVEL=info` (OpenTelemetry diagnostics).
Emergency off switch: `SAP_CALM_LOGS_ENABLED=false` (logs only) or `SAP_CALM_INSTRUMENTATION_ENABLED=false` (everything), then restart.

## SAP Cloud ALM on a BTP trial subaccount (push via Raw Data Inbound Logs API)

A trial subaccount is not discovered by Cloud ALM automatically. Therefore `srv/calm-push.js` also pushes every
**warning and error** written with `cds.log` to a service that is created **manually** in Cloud ALM:

```
cds.log warn/error -> srv/calm-push.js (buffer) -> destination CALM_datacollector (OAuth2 client credentials)
  -> POST <Cloud ALM>/api/calm-logs/v1/logs?useCase=exm.im&serviceId=<LMS ID>  -> IEM -> Exceptions
```

| Setting (`mta.yaml`, ro-order-srv) | Meaning |
|---|---|
| `SAP_CALM_PUSH_ENABLED` | `true` switches the push on |
| `SAP_CALM_PUSH_SERVICE_ID` | LMS ID of the service in Cloud ALM Landscape Management (mandatory, push stays off while empty) |
| `SAP_CALM_PUSH_DESTINATION` | BTP destination to the Cloud ALM API (default `CALM_datacollector`) |
| `SAP_CALM_PUSH_USE_CASE` | `exm.im` = Integration & Exception Monitoring exceptions |
| `SAP_CALM_PUSH_DEV` | `true` = synchronous dev mode with error details (max 100 calls / 24 h); `false` for normal use |
| `SAP_CALM_PUSH_INTERVAL` | seconds between pushes (default 60, 900 in dev mode) |
| `SAP_CALM_PUSH_LEVEL` | `warn` (default, warnings + errors) or `error` |

Prerequisites in Cloud ALM / BTP:
1. Landscape Management: create the service for `ro-order-srv` and copy its **LMS ID** into `SAP_CALM_PUSH_SERVICE_ID`
   (or without redeploy: `cf set-env ro-order-srv SAP_CALM_PUSH_SERVICE_ID <id>` + `cf restart ro-order-srv`).
2. Integration & Exception Monitoring -> Configuration: switch data collection **on** for that service (otherwise HTTP 403).
3. The OAuth client in destination `CALM_datacollector` needs the scopes `calm-api.logs.write` and `calm-api.exm.write`.

The backend log shows `SAP Cloud ALM log push active ...` and `pushed N log record(s) to SAP Cloud ALM (HTTP 202)`,
or `push to SAP Cloud ALM failed ...` with the HTTP status and Cloud ALM's error text.

## Notes

- Demo only: no authentication (`authenticationMethod: none`, CAP `auth: dummy`). Don't use it for real data.
- UI5 is loaded from `https://ui5.sap.com` (latest version).
- Node.js 22 (`engines.node: ^22.0.0`), which is supported by `nodejs_buildpack` 1.9.x.
