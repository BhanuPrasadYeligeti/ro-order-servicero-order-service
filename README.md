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

## SAP Cloud ALM (Integration & Exception Monitoring)

The backend is prepared for SAP's supported setup (SAP Cloud ALM Expert Portal -> OpenTelemetry@SAP, Node.js):

| Piece | Where |
|---|---|
| SAP Cloud ALM agent `@sap/xotel-agent-ext-js` 2.0.5, preloaded before CAP | `package.json` (optionalDependencies, start script), `srv/calm-agent.js` |
| Errors written with `cf-nodejs-logging-support` (every 4xx/5xx of OrderService) | `srv/calm-log.js`, `srv/order-service.js` |
| `SAP_CALM_SERVICE_NAME` / `SAP_CALM_SERVICE_TYPE: SAP_CP_CF` | `mta.yaml` (ro-order-srv) |
| Destination service binding, so the agent finds the subaccount destination `CALM_datacollector` | `mta.yaml` (resource `ro-order-destination`) |
| SAP repository (RBSC) auth via `SAP_NPM_AUTH` | `.npmrc` (copied to `gen/srv` at build) |

**To activate:** set `SAP_NPM_AUTH` (RBSC technical user "NPM Base64 Credentials" from SAP for Me) as a secret build variable
and as a user-provided variable of `ro-order-srv`, then build & deploy. The backend log shows
`[calm] SAP Cloud ALM agent loaded` when it is active (otherwise `... NOT installed`; the app works either way).
Then in Cloud ALM: IEM -> Configuration -> switch the subaccount service (SAP BTP, Cloud Foundry environment) ON with **Node.js Application Logs**.

## Notes

- Demo only: no authentication (`authenticationMethod: none`, CAP `auth: dummy`). Don't use it for real data.
- UI5 is loaded from `https://ui5.sap.com` (latest version).
- Node.js 22 (`engines.node: ^22.0.0`), which is supported by `nodejs_buildpack` 1.9.x.
