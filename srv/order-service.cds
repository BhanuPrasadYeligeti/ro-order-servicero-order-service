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
}
