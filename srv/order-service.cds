using { ro.sales as db } from '../db/schema';

@path: '/odata/v4/orders'
service OrderService {
  @readonly entity Customers as projection on db.Customers;
  @readonly entity Products  as projection on db.Products;
  @readonly entity Orders    as projection on db.Orders;

  // Business scenario: a sales rep places an order for a customer purchase order.
  // Business rejections (HTTP 4xx, logged as WARN once):
  //   INPUT_MISSING, CUSTOMER_NOT_FOUND, CUSTOMER_BLOCKED, PRODUCT_NOT_FOUND, PRODUCT_DISCONTINUED,
  //   QTY_PACK_SIZE, QTY_MAX_EXCEEDED, OUT_OF_STOCK, CREDIT_LIMIT_EXCEEDED
  // Technical failure (logged as ERROR once with stack trace):
  //   DUPLICATE_PO -> real SQL error "UNIQUE constraint failed" from the database, transaction rolled back
  action submitOrder(customerID : String, productID : String, quantity : Integer, customerPO : String) returns Orders;

  // Technical scenario: a call to the S/4HANA backend fails.
  // Throws an unhandled exception -> HTTP 500 -> what Cloud ALM IEM should pick up.
  action syncToS4() returns String;

  // Code bug scenario: backend reads a property of a record that was not found (null).
  // Throws TypeError: Cannot read properties of null -> HTTP 500 -> pushed to Cloud ALM as an exception.
  action simulateNullPointer() returns String;
}
