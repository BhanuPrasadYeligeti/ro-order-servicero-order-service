namespace ro.sales;

using { cuid, managed } from '@sap/cds/common';

// Sold-to parties with their credit limit (like SAP SD credit management, FD32 / UKM_BP)
entity Customers {
  key ID          : String(10);
      name        : String(100);
      city        : String(40);
      creditLimit : Decimal(12, 2);
      currency    : String(3);
      blocked     : Boolean default false;  // delivery / order block
      blockReason : String(200);
}

entity Products {
  key ID           : String(10);
      name         : String(100);
      category     : String(40);
      price        : Decimal(10, 2);
      currency     : String(3);
      stock        : Integer;
      reorderLevel : Integer default 5;     // "low stock" warning below this level
      packSize     : Integer default 1;     // order quantity must be a multiple of this
      maxOrderQty  : Integer default 999;   // max quantity per order line
      discontinued : Boolean default false;
      successor    : String(10);            // product to order instead when discontinued
}

// customerPO is unique in the DATABASE: sending the same purchase order twice fails with a real
// SQL error (UNIQUE constraint failed) -> the whole transaction (incl. the stock update) is rolled back.
@assert.unique: { customerPO: [customerPO] }
entity Orders : cuid, managed {
  orderNo    : String(20);
  customerPO : String(35);                 // customer's purchase order number, e.g. PO-CLOUDFULCRUM-2026-1045
  customer   : Association to Customers;
  product    : Association to Products;
  quantity   : Integer;
  netAmount  : Decimal(12, 2);
  currency   : String(3);
  status     : String(20);                 // CREATED
}
