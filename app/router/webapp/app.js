/* Sales order UI (SAPUI5). Talks to the CAP backend through the approuter: /odata/v4/orders/... */
sap.ui.define([
  "sap/m/App", "sap/m/Page", "sap/m/Table", "sap/m/Column", "sap/m/ColumnListItem", "sap/m/Text",
  "sap/m/ObjectNumber", "sap/m/ObjectStatus", "sap/m/Input", "sap/m/Select", "sap/ui/core/Item", "sap/m/StepInput",
  "sap/m/Button", "sap/m/Label", "sap/m/Title", "sap/m/Toolbar", "sap/m/ToolbarSpacer", "sap/m/HBox",
  "sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/layout/form/SimpleForm", "sap/ui/model/json/JSONModel"
], function (App, Page, Table, Column, ColumnListItem, Text, ObjectNumber, ObjectStatus, Input, Select, Item, StepInput,
             Button, Label, Title, Toolbar, ToolbarSpacer, HBox, MessageBox, MessageToast, SimpleForm, JSONModel) {
  "use strict";

  const SRV = "/odata/v4/orders";

  // Titles for the business rejections returned by the backend (error.code)
  const TITLES = {
    INPUT_MISSING: "Missing input",
    CUSTOMER_NOT_FOUND: "Unknown customer",
    CUSTOMER_BLOCKED: "Customer blocked",
    PRODUCT_NOT_FOUND: "Unknown product",
    PRODUCT_DISCONTINUED: "Product discontinued",
    QTY_PACK_SIZE: "Invalid quantity",
    QTY_MAX_EXCEEDED: "Quantity too high",
    OUT_OF_STOCK: "Out of stock",
    CREDIT_LIMIT_EXCEEDED: "Credit limit exceeded",
    DUPLICATE_PO: "Duplicate purchase order"
  };

  const newPO = (customerID) => {
    const c = model && model.getProperty("/customers").find((x) => x.ID === customerID);
    // e.g. "Cloudfulcrum Pvt Ltd" -> CLOUDFULCRUM, "SAP CPI" -> SAPCPI, "Dwp Global Corp" -> DWPGLOBAL
    const short = c ? c.name.replace(/\b(pvt|ltd|corp|inc)\b\.?/gi, "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 12) : "CUST";
    return `PO-${short}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  };

  const model = new JSONModel({
    customers: [], products: [], orders: [],
    customerID: "C-1001", customerPO: "PO-CLOUDFULCRUM-" + new Date().getFullYear() + "-1045", productID: "HT-1000", quantity: 1
  });

  // Every request gets a reference ID (x-correlation-id). The backend logs it with every record,
  // so the ID shown to the user can be searched in Cloud ALM / Application Logging.
  async function call(method, path, body) {
    const ref = crypto.randomUUID();
    let res;
    try {
      res = await fetch(SRV + path, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", "x-correlation-id": ref },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw Object.assign(new Error("No network connection to the order service."), { status: 0, ref });
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json && json.error) || {};
      // No JSON error from CAP -> the request never reached the backend (app stopped / route missing on BTP)
      const message = err.message ||
        (res.status === 404 || res.status === 502 || res.status === 503
          ? "The order service (ro-order-srv) is not reachable. The backend app may be stopped – please try again later."
          : res.statusText);
      throw Object.assign(new Error(message), { status: res.status, code: err.code, ref, reachable: !!json });
    }
    return json;
  }

  function showError(action, e) {
    if (e.status >= 400 && e.status < 500 && e.reachable) {
      // Business rejection: the user can fix it
      MessageBox.warning(e.message, { title: TITLES[e.code] || action });
    } else {
      // Technical problem: the user cannot fix it -> give a reference for support
      MessageBox.error(`${e.message}\n\nReference: ${e.ref}`, { title: `${action} – technical error` });
    }
  }

  async function load() {
    try {
      const [c, p, o] = await Promise.all([
        call("GET", "/Customers?$orderby=ID"),
        call("GET", "/Products?$orderby=ID"),
        call("GET", "/Orders?$orderby=createdAt desc&$expand=customer($select=name),product($select=name)")
      ]);
      // credit used = open orders per customer
      const used = {};
      o.value.forEach((x) => { used[x.customer_ID] = (used[x.customer_ID] || 0) + Number(x.netAmount); });
      c.value.forEach((x) => { x.creditUsed = used[x.ID] || 0; });
      model.setProperty("/customers", c.value);
      model.setProperty("/products", p.value);
      model.setProperty("/orders", o.value);
    } catch (e) {
      showError("Could not load data", e);
    }
  }

  async function submitOrder() {
    const d = model.getData();
    try {
      const order = await call("POST", "/submitOrder",
        { customerID: d.customerID, productID: d.productID, quantity: d.quantity, customerPO: d.customerPO });
      MessageToast.show(`Order ${order.orderNo} created for PO ${order.customerPO}: ${order.netAmount} ${order.currency}`);
    } catch (e) {
      showError("Order rejected", e);
    }
    load(); // always refresh: stock / credit may have changed
  }

  async function syncToS4() {
    try {
      await call("POST", "/syncToS4", {});
      MessageToast.show("Orders synchronised with S/4HANA");
    } catch (e) {
      showError("S/4HANA sync failed", e);
    }
  }

  // Triggers a null pointer exception (TypeError) in the CAP backend -> HTTP 500 -> pushed to SAP Cloud ALM
  async function simulateNullPointer() {
    try {
      await call("POST", "/simulateNullPointer", {});
      MessageToast.show("Delivery address loaded");
    } catch (e) {
      showError("Loading delivery address failed", e);
    }
  }

  const refreshBtn = () => new Button({ icon: "sap-icon://refresh", tooltip: "Refresh", press: load });

  const customersTable = new Table({
    headerToolbar: new Toolbar({ content: [new Title({ text: "Customers" }), new ToolbarSpacer(), refreshBtn()] }),
    columns: ["Customer", "Name", "City", "Credit Limit", "Open Orders", "Status"].map((t) => new Column({ header: new Text({ text: t }) })),
    items: {
      path: "/customers",
      template: new ColumnListItem({ cells: [
        new Text({ text: "{ID}" }), new Text({ text: "{name}" }), new Text({ text: "{city}" }),
        new ObjectNumber({ number: "{creditLimit}", unit: "{currency}" }),
        new ObjectNumber({ number: "{creditUsed}", unit: "{currency}" }),
        new ObjectStatus({
          text: { path: "blocked", formatter: (b) => (b ? "Blocked" : "Active") },
          state: { path: "blocked", formatter: (b) => (b ? "Error" : "Success") },
          tooltip: "{blockReason}"
        })
      ] })
    }
  });

  const productsTable = new Table({
    headerToolbar: new Toolbar({ content: [new Title({ text: "Products" }), new ToolbarSpacer(), refreshBtn()] }),
    columns: ["Product", "Name", "Category", "Price", "Stock", "Pack Size", "Max / Order", "Status"].map((t) => new Column({ header: new Text({ text: t }) })),
    items: {
      path: "/products",
      template: new ColumnListItem({ cells: [
        new Text({ text: "{ID}" }), new Text({ text: "{name}" }), new Text({ text: "{category}" }),
        new ObjectNumber({ number: "{price}", unit: "{currency}" }),
        new ObjectNumber({ number: "{stock}", state: { parts: ["stock", "reorderLevel"],
          formatter: (s, r) => (s <= 0 ? "Error" : s < r ? "Warning" : "Success") } }),
        new Text({ text: "{packSize}" }), new Text({ text: "{maxOrderQty}" }),
        new ObjectStatus({
          text: { parts: ["discontinued", "successor"], formatter: (d, s) => (d ? `Discontinued${s ? " → " + s : ""}` : "Active") },
          state: { path: "discontinued", formatter: (d) => (d ? "Warning" : "Success") }
        })
      ] })
    }
  });

  const orderForm = new SimpleForm({
    title: "Create Sales Order",
    editable: true,
    content: [
      new Label({ text: "Customer", required: true }),
      new Select({ selectedKey: "{/customerID}", items: { path: "/customers", template: new Item({ key: "{ID}", text: "{ID} – {name}" }) },
        change: (e) => model.setProperty("/customerPO", newPO(e.getSource().getSelectedKey())) }),
      new Label({ text: "Customer PO Number", required: true }),
      new HBox({ items: [
        new Input({ value: "{/customerPO}", width: "16rem" }),
        new Button({ text: "New PO", icon: "sap-icon://add-document", tooltip: "Generate a new PO number",
          press: () => model.setProperty("/customerPO", newPO(model.getProperty("/customerID"))) })
      ] }),
      new Label({ text: "Product", required: true }),
      new Select({ selectedKey: "{/productID}", items: { path: "/products", template: new Item({ key: "{ID}", text: "{ID} – {name}" }) } }),
      new Label({ text: "Quantity", required: true }), new StepInput({ value: "{/quantity}", min: 1, max: 999 }),
      new Label({ text: "" }), new Button({ text: "Place Order", type: "Emphasized", press: submitOrder })
    ]
  });

  const ordersTable = new Table({
    headerToolbar: new Toolbar({ content: [new Title({ text: "Sales Orders" }), new ToolbarSpacer(),
      new Button({ text: "Sync to S/4HANA", icon: "sap-icon://synchronize", press: syncToS4 }),
      new Button({ text: "Simulate Null Pointer", icon: "sap-icon://error", type: "Reject", press: simulateNullPointer })] }),
    noDataText: "No orders yet",
    columns: ["Order", "Customer PO", "Customer", "Product", "Qty", "Net Amount", "Status"].map((t) => new Column({ header: new Text({ text: t }) })),
    items: {
      path: "/orders",
      template: new ColumnListItem({ cells: [
        new Text({ text: "{orderNo}" }), new Text({ text: "{customerPO}" }), new Text({ text: "{customer/name}" }),
        new Text({ text: "{product_ID} – {product/name}" }), new Text({ text: "{quantity}" }),
        new ObjectNumber({ number: "{netAmount}", unit: "{currency}" }), new ObjectStatus({ text: "{status}", state: "Success" })
      ] })
    }
  });

  const app = new App({ pages: [new Page({ title: "Sales Orders – ReleaseOwl Demo",
    content: [customersTable, productsTable, orderForm, ordersTable] })] });
  app.setModel(model);
  app.placeAt("content");
  load();
});
