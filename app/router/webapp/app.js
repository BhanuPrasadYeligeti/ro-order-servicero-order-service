/* Sales order UI (SAPUI5). Talks to the CAP backend through the approuter: /odata/v4/orders/... */
sap.ui.define([
  "sap/m/App", "sap/m/Page", "sap/m/Table", "sap/m/Column", "sap/m/ColumnListItem", "sap/m/Text",
  "sap/m/ObjectNumber", "sap/m/Input", "sap/m/Select", "sap/ui/core/Item", "sap/m/StepInput",
  "sap/m/Button", "sap/m/Label", "sap/m/Title", "sap/m/Toolbar", "sap/m/ToolbarSpacer",
  "sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/layout/form/SimpleForm", "sap/ui/model/json/JSONModel"
], function (App, Page, Table, Column, ColumnListItem, Text, ObjectNumber, Input, Select, Item, StepInput,
             Button, Label, Title, Toolbar, ToolbarSpacer, MessageBox, MessageToast, SimpleForm, JSONModel) {
  "use strict";

  const SRV = "/odata/v4/orders";
  const model = new JSONModel({ products: [], orders: [], customer: "Bosch India Pvt Ltd", productID: "HT-1000", quantity: 1 });

  async function call(method, path, body) {
    const res = await fetch(SRV + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && json.error.message) || res.statusText;
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return json;
  }

  async function load() {
    try {
      const [p, o] = await Promise.all([call("GET", "/Products?$orderby=ID"), call("GET", "/Orders?$orderby=createdAt desc")]);
      model.setProperty("/products", p.value);
      model.setProperty("/orders", o.value);
    } catch (e) {
      MessageBox.error("Could not load data: " + e.message);
    }
  }

  async function submitOrder() {
    const d = model.getData();
    try {
      const order = await call("POST", "/submitOrder", { customer: d.customer, productID: d.productID, quantity: d.quantity });
      MessageToast.show(`Order ${order.orderNo} created: ${order.netAmount} ${order.currency}`);
      load();
    } catch (e) {
      MessageBox.error("Order rejected – " + e.message);
    }
  }

  async function syncToS4() {
    try {
      await call("POST", "/syncToS4", {});
      MessageToast.show("Orders synchronised with S/4HANA");
    } catch (e) {
      MessageBox.error("S/4HANA sync failed – " + e.message);
    }
  }

  // Triggers a null pointer exception (TypeError) in the CAP backend -> HTTP 500 -> pushed to SAP Cloud ALM
  async function simulateNullPointer() {
    try {
      await call("POST", "/simulateNullPointer", {});
      MessageToast.show("Delivery address loaded");
    } catch (e) {
      MessageBox.error("Null pointer exception in backend – " + e.message);
    }
  }

  const productsTable = new Table({
    headerToolbar: new Toolbar({ content: [new Title({ text: "Products" }), new ToolbarSpacer(),
      new Button({ icon: "sap-icon://refresh", tooltip: "Refresh", press: load })] }),
    columns: ["Product", "Name", "Category", "Price", "Stock"].map((t) => new Column({ header: new Text({ text: t }) })),
    items: {
      path: "/products",
      template: new ColumnListItem({ cells: [
        new Text({ text: "{ID}" }), new Text({ text: "{name}" }), new Text({ text: "{category}" }),
        new ObjectNumber({ number: "{price}", unit: "{currency}" }),
        new ObjectNumber({ number: "{stock}", state: { path: "stock", formatter: (s) => (s > 0 ? "Success" : "Error") } })
      ] })
    }
  });

  const orderForm = new SimpleForm({
    title: "Create Sales Order",
    editable: true,
    content: [
      new Label({ text: "Customer" }), new Input({ value: "{/customer}" }),
      new Label({ text: "Product" }),
      new Select({ selectedKey: "{/productID}", items: { path: "/products", template: new Item({ key: "{ID}", text: "{ID} – {name}" }) } }),
      new Label({ text: "Quantity" }), new StepInput({ value: "{/quantity}", min: 1, max: 999 }),
      new Label({ text: "" }), new Button({ text: "Place Order", type: "Emphasized", press: submitOrder })
    ]
  });

  const ordersTable = new Table({
    headerToolbar: new Toolbar({ content: [new Title({ text: "Sales Orders" }), new ToolbarSpacer(),
      new Button({ text: "Sync to S/4HANA", icon: "sap-icon://synchronize", press: syncToS4 }),
      new Button({ text: "Simulate Null Pointer", icon: "sap-icon://error", type: "Reject", press: simulateNullPointer })] }),
    noDataText: "No orders yet",
    columns: ["Order", "Customer", "Product", "Qty", "Net Amount", "Status"].map((t) => new Column({ header: new Text({ text: t }) })),
    items: {
      path: "/orders",
      template: new ColumnListItem({ cells: [
        new Text({ text: "{orderNo}" }), new Text({ text: "{customer}" }), new Text({ text: "{product_ID}" }),
        new Text({ text: "{quantity}" }), new ObjectNumber({ number: "{netAmount}", unit: "{currency}" }), new Text({ text: "{status}" })
      ] })
    }
  });

  const app = new App({ pages: [new Page({ title: "Sales Orders – ReleaseOwl Demo", content: [productsTable, orderForm, ordersTable] })] });
  app.setModel(model);
  app.placeAt("content");
  load();
});
