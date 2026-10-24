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

## Notes

- Demo only: no authentication (`authenticationMethod: none`, CAP `auth: dummy`). Don't use it for real data.
- UI5 is loaded from `https://ui5.sap.com` (latest version).
- Node.js 22 (`engines.node: ^22.0.0`), which is supported by `nodejs_buildpack` 1.9.x.
