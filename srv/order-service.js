const cds = require('@sap/cds');
const LOG = cds.log('order-service');

module.exports = class OrderService extends cds.ApplicationService {
  async init() {
    const { Products, Orders } = cds.entities('ro.sales');

    this.on('submitOrder', async (req) => {
      const { customer, productID, quantity } = req.data;
      LOG.info(`submitOrder received: customer="${customer}" product=${productID} qty=${quantity}`);

      if (!customer || !productID || !(quantity > 0)) {
        LOG.warn(`submitOrder rejected: invalid input ${JSON.stringify(req.data)}`);
        return req.error(400, 'customer, productID and a positive quantity are required');
      }

      const product = await SELECT.one.from(Products).where({ ID: productID });
      if (!product) {
        LOG.error(`submitOrder failed: product ${productID} not found`);
        return req.error(404, `Product ${productID} not found`);
      }

      if (product.stock < quantity) {
        LOG.error(`submitOrder failed: insufficient stock for ${productID} (requested ${quantity}, available ${product.stock})`);
        return req.error(409, `Insufficient stock for product ${productID}: requested ${quantity}, available ${product.stock}`);
      }

      await UPDATE(Products, productID).with({ stock: { '-=': quantity } });

      const order = {
        ID: cds.utils.uuid(),
        orderNo: `SO-${Date.now().toString().slice(-8)}`,
        customer,
        product_ID: productID,
        quantity,
        netAmount: Number(product.price) * quantity,
        currency: product.currency,
        status: 'CREATED'
      };
      await INSERT.into(Orders).entries(order);
      LOG.info(`Order ${order.orderNo} created for ${customer}: ${quantity} x ${productID} = ${order.netAmount} ${order.currency}`);
      return order;
    });

    this.on('syncToS4', async () => {
      LOG.info('syncToS4 started: pushing open orders to S/4HANA (API_SALES_ORDER_SRV)');
      // Simulates a real backend outage. Deliberately NOT caught -> HTTP 500 + stack trace in logs.
      const err = new Error('Connection to S/4HANA backend failed: connect ECONNREFUSED 10.20.30.40:443 (destination S4H_SALES_ORDER)');
      err.code = 'ECONNREFUSED';
      throw err;
    });

    // Every failed request (4xx business errors and 5xx technical errors) is logged with cds.log.
    // @cap-js/telemetry hands every cds.log record to the SAP Cloud ALM agent (ExmLogProcessor, see package.json),
    // so the error - with exception.message / exception.stacktrace when an Error object is passed - shows up in SAP Cloud ALM.
    this.on('error', (err, req) => {
      const status = err.status || err.statusCode || (Number(err.code) >= 400 ? Number(err.code) : 500);
      const what = (req && (req.event || req.path)) || (err.target ? `request on ${err.target}` : 'OrderService request');
      if (status >= 500) LOG.error(`${what} failed with HTTP ${status}:`, err);
      else LOG.error(`${what} failed with HTTP ${status}: ${err.message}`);
    });

    return super.init();
  }
};
