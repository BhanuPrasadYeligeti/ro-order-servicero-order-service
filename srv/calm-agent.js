'use strict';
/*
 * SAP Cloud ALM agent loader - preloaded before CAP starts (package.json: NODE_OPTIONS=--require ./srv/calm-agent.js).
 *
 * SAP's supported setup (SAP Cloud ALM Expert Portal -> OpenTelemetry@SAP -> Auto-instrumentation for Node.js):
 *   - @sap/xotel-agent-ext-js is downloaded from SAP's repository (RBSC) at build/staging time,
 *     using the SAP_NPM_AUTH credentials referenced in .npmrc
 *   - it reads SAP_CALM_SERVICE_NAME / SAP_CALM_SERVICE_TYPE (mta.yaml) and sends data to
 *     SAP Cloud ALM via the subaccount destination CALM_datacollector
 *
 * The agent is an optional dependency: without SAP_NPM_AUTH the app still builds and runs,
 * it just logs that nothing is sent to Cloud ALM.
 */
let loaded = false;
try {
  require('@sap/xotel-agent-ext-js');
  loaded = true;
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}
process.env.SAP_CALM_AGENT_LOADED = loaded ? 'true' : 'false';
console.log(loaded
  ? '[calm] SAP Cloud ALM agent loaded - error logs are sent to SAP Cloud ALM'
  : '[calm] SAP Cloud ALM agent NOT installed (build without SAP_NPM_AUTH) - nothing is sent to SAP Cloud ALM');
