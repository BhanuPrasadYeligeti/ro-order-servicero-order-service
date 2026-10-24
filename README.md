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

| Action in UI | Backend result | Backend log |
|---|---|---|
| Open app | Products list loads | info |
| Place Order (HT-1000, qty 2) | Order `SO-xxxxxxxx` created | info |
| Place Order for **HT-1068** (stock 0) | **409** "Insufficient stock" | **error** |
| **Sync to S/4HANA** | **500** "Connection to S/4HANA backend failed: ECONNREFUSED" | **error + stack trace** |

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

## Notes

- Demo only: no authentication (`authenticationMethod: none`, CAP `auth: dummy`). Don't use it for real data.
- UI5 is loaded from `https://ui5.sap.com` (latest version).
- Node.js 22 (`engines.node: ^22.0.0`), which is supported by `nodejs_buildpack` 1.9.x.
