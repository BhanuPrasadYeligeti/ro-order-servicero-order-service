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

## SAP Cloud ALM (OpenTelemetry@SAP, Exception Monitoring)

Branch `OpenTelemantary` follows SAP Cloud ALM Expert Portal -> OpenTelemetry@SAP -> Auto-instrumentation for Node.js,
"Additional steps for Exception Monitoring -> Custom-built applications using CDS library".

```
cds.log('order-service').error(...) -> @cap-js/telemetry -> ExmLogProcessor (@sap/xotel-agent-ext-js)
  -> destination CALM_datacollector (OAuth2ClientCredentials) -> SAP Cloud ALM -> IEM -> Exceptions
```

| Piece | Where |
|---|---|
| Agent `@sap/xotel-agent-ext-js` 2.0.5 from SAP RBSC, `@cap-js/telemetry` 2.0.1, `@opentelemetry/exporter-logs-otlp-grpc` | `package.json` dependencies |
| RBSC login `_auth=${SAP_NPM_AUTH}` (never the real value in Git) | `.npmrc` |
| Start script `node ${NODE_ARGS} ./node_modules/.bin/cds-serve` | `package.json` scripts |
| `cds.requires.telemetry.logging` -> processor `ExmLogProcessor`, exporter `OTLPLogExporter` | `package.json` |
| `SAP_CALM_SERVICE_NAME`, `SAP_CALM_SERVICE_TYPE: SAP_CP_CF`, `NODE_ARGS: -r @sap/xotel-agent-ext-js` | `mta.yaml` (ro-order-srv) |
| node_modules installed into `gen/srv` at build and packed into the MTAR (no RBSC access needed in CF) | `mta.yaml` (before-all, ro-order-srv build-parameters) |
| Destination service binding (agent reads `CALM_datacollector`) | `mta.yaml` (resource `ro-order-destination`) |
| Errors logged with `cds.log`, 5xx with the Error object (stack trace) | `srv/order-service.js` |

Prerequisites:
1. **Build pipeline:** secret `SAP_NPM_AUTH` = "NPM Base64 Credentials" of the RBSC technical user (RBSC UI).
2. **BTP provider subaccount:** destination `CALM_datacollector` - HTTP, Internet, OAuth2ClientCredentials, URL = Cloud ALM API
   endpoint, client ID / secret / token URL from the Cloud ALM API service key ("Check Connection" may return 404, that is fine).
3. **Cloud ALM:** activate Exception Monitoring for the service `ro-order-srv` (IEM -> Configuration).
4. Trigger errors in the UI (HT-1068 -> 409, Sync to S/4HANA -> 500, Simulate Null Pointer -> 500).

Troubleshooting: `SAP_CALM_DCI_LOG_LEVEL=debug` (agent log), `OTEL_LOG_LEVEL=info` (OpenTelemetry diagnostics).

## Notes

- Demo only: no authentication (`authenticationMethod: none`, CAP `auth: dummy`). Don't use it for real data.
- UI5 is loaded from `https://ui5.sap.com` (latest version).
- Node.js 22 (`engines.node: ^22.0.0`), which is supported by `nodejs_buildpack` 1.9.x.
