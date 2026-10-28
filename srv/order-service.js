const cds = require('@sap/cds');
const LOG = cds.log('order-service');

module.exports = class OrderService extends cds.ApplicationService {
  async init() {
    const { Products, Orders, Customers } = cds.entities('ro.sales');

    const fmt = (n, cur) => `${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

    // Business rejection: expected situation (not a system fault) -> ONE warning log + clear message for the user.
    // The on('error') handler below does not log 4xx again, so there are no duplicates in Cloud ALM.
    const reject = (req, status, code, message) => {
      LOG.warn(`submitOrder rejected [${code}]: ${message}`);
      return req.reject({ status, code, message });
    };

    this.on('submitOrder', async (req) => {
      const { customerID, productID, quantity } = req.data;
      const customerPO = (req.data.customerPO || '').trim();
      LOG.info(`submitOrder received: customer=${customerID} PO=${customerPO} product=${productID} qty=${quantity}`);

      if (!customerID || !productID || !customerPO || !(quantity > 0)) {
        return reject(req, 400, 'INPUT_MISSING', 'Customer, customer PO number, product and a quantity greater than 0 are required');
      }

      // 1. Customer master data + order block
      const customer = await SELECT.one.from(Customers).where({ ID: customerID });
      if (!customer) return reject(req, 404, 'CUSTOMER_NOT_FOUND', `Customer ${customerID} does not exist`);
      if (customer.blocked) {
        return reject(req, 403, 'CUSTOMER_BLOCKED', `Customer ${customer.name} (${customer.ID}) is blocked for new orders. ${customer.blockReason || ''}`.trim());
      }

      // 2. Product master data
      const product = await SELECT.one.from(Products).where({ ID: productID });
      if (!product) return reject(req, 404, 'PRODUCT_NOT_FOUND', `Product ${productID} does not exist`);
      if (product.discontinued) {
        return reject(req, 410, 'PRODUCT_DISCONTINUED',
          `${product.name} (${product.ID}) is discontinued and can no longer be ordered` + (product.successor ? `. Please order the successor ${product.successor} instead` : ''));
      }

      // 3. Quantity rules
      if (product.packSize > 1 && quantity % product.packSize !== 0) {
        return reject(req, 400, 'QTY_PACK_SIZE',
          `${product.name} is sold in packs of ${product.packSize}. Please order ${Math.floor(quantity / product.packSize) * product.packSize || product.packSize} or ${Math.ceil(quantity / product.packSize) * product.packSize} instead of ${quantity}`);
      }
      if (quantity > product.maxOrderQty) {
        return reject(req, 400, 'QTY_MAX_EXCEEDED', `Maximum ${product.maxOrderQty} units of ${product.name} per order (requested ${quantity}). Please split the order`);
      }

      // 4. Availability check
      if (product.stock < quantity) {
        return reject(req, 409, 'OUT_OF_STOCK', product.stock === 0
          ? `${product.name} (${product.ID}) is out of stock`
          : `Only ${product.stock} units of ${product.name} (${product.ID}) are available, you ordered ${quantity}`);
      }

      // 5. Credit check: open orders + this order must not exceed the customer's credit limit
      const netAmount = Number(product.price) * quantity;
      const { open } = await SELECT.one`coalesce(sum(netAmount), 0) as open`.from(Orders).where({ customer_ID: customerID, status: 'CREATED' });
      const limit = Number(customer.creditLimit);
      if (Number(open) + netAmount > limit) {
        return reject(req, 409, 'CREDIT_LIMIT_EXCEEDED',
          `Credit limit exceeded for ${customer.name}: open orders ${fmt(open, customer.currency)} + this order ${fmt(netAmount, product.currency)} ` +
          `= ${fmt(Number(open) + netAmount, customer.currency)}, credit limit ${fmt(limit, customer.currency)}`);
      }

      // 6. Save: stock update + order insert run in ONE transaction (the request transaction).
      const order = {
        ID: cds.utils.uuid(),
        orderNo: `SO-${Date.now().toString().slice(-8)}`,
        customerPO,
        customer_ID: customerID,
        product_ID: productID,
        quantity,
        netAmount,
        currency: product.currency,
        status: 'CREATED'
      };
      try {
        await UPDATE(Products, productID).with({ stock: { '-=': quantity } });
        await INSERT.into(Orders).entries(order);
      } catch (err) {
        // Real database error. Example: the same customer PO is sent twice (double click / interface resend)
        // -> UNIQUE constraint on Orders.customerPO fails. Throwing rolls back the stock update as well.
        const sqlError = err.code || err.name;
        LOG.error(`submitOrder failed: database error ${sqlError} while saving PO ${customerPO} for ${customer.name} - transaction rolled back:`, err);
        if (/UNIQUE|unique constraint|ENTITY_ALREADY_EXISTS/i.test(`${err.code} ${err.message}`)) {
          return req.reject({ status: 409, code: 'DUPLICATE_PO', logged: true,
            message: `Purchase order ${customerPO} was already received for ${customer.name}. The order was not saved again (database: ${sqlError})` });
        }
        err.logged = true;
        throw err;
      }
      LOG.info(`Order ${order.orderNo} created for ${customer.name}, PO ${customerPO}: ${quantity} x ${productID} = ${fmt(netAmount, order.currency)}`);

      // Real warning: only when this order pushes the stock below the reorder level
      const left = product.stock - quantity;
      if (left < product.reorderLevel) {
        LOG.warn(`Low stock: ${product.name} (${productID}) has ${left} units left after order ${order.orderNo}, reorder level is ${product.reorderLevel}`);
      }
      return order;
    });

    this.on('syncToS4', async () => {
      LOG.info('syncToS4 started: pushing open orders to S/4HANA (API_SALES_ORDER_SRV)');
      // Simulates a real backend outage. Deliberately NOT caught -> HTTP 500 + stack trace in logs.
      const err = new Error('Connection to S/4HANA backend failed: connect ECONNREFUSED 10.20.30.40:443 (destination S4H_SALES_ORDER)');
      err.code = 'ECONNREFUSED';
      throw err;
    });

    this.on('simulateNullPointer', async () => {
      const orderNo = 'SO-00000000';
      LOG.info(`simulateNullPointer started: reading delivery address of order ${orderNo}`);
      // Real-world bug: the lookup returns null for an unknown order and the code reads a property of it
      // without a null check. Deliberately NOT caught -> TypeError -> HTTP 500 + stack trace -> Cloud ALM.
      const order = await SELECT.one.from(Orders).where({ orderNo });
      const city = order.shippingAddress.city; // order is null -> TypeError: Cannot read properties of null
      return `Order ${orderNo} ships to ${city}`;
    });

    // Technical errors (HTTP 5xx) are logged here ONCE with the Error object -> exception.message / exception.stacktrace
    // in SAP Cloud ALM (srv/calm-push.js). Business rejections (4xx) were already logged as warnings in the handler.
    this.on('error', (err, req) => {
      const status = err.status || err.statusCode || (Number(err.code) >= 400 ? Number(err.code) : 500);
      if (status < 500 || err.logged) return;
      const what = (req && (req.event || req.path)) || 'OrderService request';
      LOG.error(`${what} failed with HTTP ${status}:`, err);
    });

    return super.init();
  }
};
