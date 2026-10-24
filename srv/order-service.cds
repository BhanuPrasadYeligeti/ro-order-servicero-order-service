using { ro.sales as db } from '../db/schema';

@path: '/odata/v4/orders'
service OrderService {
  @readonly entity Products as projection on db.Products;
  @readonly entity Orders   as projection on db.Orders;

  // Business scenario: a sales rep places an order.
  // Fails with 404 (unknown product) or 409 (insufficient stock).
  action submitOrder(customer : String, productID : String, quantity : Integer) returns Orders;

  // Technical scenario: a call to the S/4HANA backend fails.
  // Throws an unhandled exception -> HTTP 500 -> what Cloud ALM IEM should pick up.
  action syncToS4() returns String;

  // Code bug scenario: backend reads a property of a record that was not found (null).
  // Throws TypeError: Cannot read properties of null -> HTTP 500 -> pushed to Cloud ALM as an exception.
  action simulateNullPointer() returns String;
}
