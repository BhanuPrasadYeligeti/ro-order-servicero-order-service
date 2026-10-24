namespace ro.sales;

using { cuid, managed } from '@sap/cds/common';

entity Products {
  key ID       : String(10);
      name     : String(100);
      category : String(40);
      price    : Decimal(10, 2);
      currency : String(3);
      stock    : Integer;
}

entity Orders : cuid, managed {
  orderNo   : String(20);
  customer  : String(100);
  product   : Association to Products;
  quantity  : Integer;
  netAmount : Decimal(12, 2);
  currency  : String(3);
  status    : String(20); // CREATED | REJECTED
}
