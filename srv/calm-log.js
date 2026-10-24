'use strict';
/*
 * Error logger for SAP Cloud ALM Exception Monitoring.
 * SAP's agent collects error-level records written with cf-nodejs-logging-support
 * ("Additional steps for Exception Monitoring"), so every failed request is logged here as well.
 */
const log = require('cf-nodejs-logging-support');

log.setLoggingLevel(process.env.LOG_LEVEL || 'info');

module.exports = log.createLogger({ component: 'ro-order-srv' });
