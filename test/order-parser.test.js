import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseOrders } from "../src/services/orderParser.js";
import { buildAllPayloads } from "../src/services/orderBuilder.js";
import { buildImportRows } from "../src/services/orderImportExporter.js";
import { assignArtworks } from "../src/services/artworkAssignment.js";

const root = process.cwd();
const sampleCatalog = JSON.parse(await fs.readFile(path.join(root, "data/catalog.json"), "utf8"));

test("parses the two Notebook packing slips and their customer fields", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Notebook/input.pdf"));
  const orders = await parseOrders(pdf, []);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].shippingName, "Stacey Wierman");
  assert.equal(orders[0].city, "MONTICELLO");
  assert.equal(orders[0].items[0].quantity, 37);
  assert.equal(orders[0].items[0].productCodeSource, "EJ-7");
  assert.equal(orders[1].shippingName, "Jordan Axenfeld");
});

test("maps Flower Pot source sizes through catalog config", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Flower Pot/input.pdf"));
  const orders = await parseOrders(pdf, []);
  const payloads = buildAllPayloads(orders, { ...sampleCatalog, spus: [{ spu: "UFP", name: "Flower Pot", aliases: ["gf-10"] }] }, "http://localhost:3000");
  assert.equal(orders[0].items[0].sizeRaw, '4.5"x4.5"x2.7"');
  assert.equal(payloads[0].payload.items[0].size, "Large");
  assert.equal(payloads[1].payload.items[0].size, "Small");
});

test("maps SKU prefixes to the same SPU", () => {
  const order = { orderNumber: "PB-PREFIX", items: [{ productCodeSource: "GF-20", title: "Flower Pot", quantity: 1, sizeRaw: "" }], artworks: [{ urlPath: "/flower.png" }] };
  const payloads = buildAllPayloads([order], { ...sampleCatalog, spus: [{ spu: "UFP", name: "Flower Pot", skuPrefixes: ["GF"] }] }, "http://localhost:3000");
  assert.equal(payloads[0].payload.items[0].productSpu, "UFP");
});

test("maps sizes by SKU prefix", () => {
  const order = { orderNumber: "PB-SIZE-PREFIX", items: [{ productCodeSource: "GF-20", title: "Flower Pot", quantity: 1, sizeRaw: '2"x2"x3' }], artworks: [{ urlPath: "/flower.png" }] };
  const payloads = buildAllPayloads([order], { ...sampleCatalog, sizeMappings: { GF: { "2x2x3": "Small" } }, spus: [{ spu: "UFP", name: "Flower Pot", skuPrefixes: ["GF"] }] }, "http://localhost:3000");
  assert.equal(payloads[0].payload.items[0].size, "Small");
  assert.equal(payloads[0].skipped, false);
});

test("parses Jewelry Storage color and personalization", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Jewelry Storage/input.pdf"));
  const [order] = await parseOrders(pdf, []);
  assert.equal(order.shippingAddress2, "");
  assert.equal(order.items[0].productCodeSource, "JS-3");
  assert.equal(order.items[0].color, "Blue");
  assert.equal(order.items[0].personalization, "Iona");
});

test("keeps one bulk item and raises quantity to the artwork count", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Notebook/input.pdf"));
  const artworks = [
    ...Array.from({ length: 37 }, (_, index) => ({ originalname: `${index + 1}_Stacey Wierman_${index}.png`, urlPath: `/stacey-${index}.png` })),
    { originalname: "38_Jordan Axenfeld_0.png", urlPath: "/jordan.png" }
  ];
  const orders = await parseOrders(pdf, artworks);
  assert.equal(orders[0].items.length, 1);
  assert.equal(orders[0].items[0].quantity, 37);
  assert.equal(orders[0].items[0].artworkCount, 37);
  assert.equal(orders[0].valid, true);
});

test("assigns multiple items top-down and rejects a mismatch", () => {
  const files = [
    { filename: "1_A.png", urlPath: "/a.png" },
    { filename: "2_A.png", urlPath: "/b.png" }
  ];
  const valid = assignArtworks({ shippingName: "A", items: [{ quantity: 1 }, { quantity: 1 }], artworks: files });
  assert.equal(valid.valid, true);
  assert.equal(valid.items[0].artwork.urlPath, "/a.png");
  assert.equal(valid.items[1].artwork.urlPath, "/b.png");
  const invalid = assignArtworks({ shippingName: "A", items: [{ quantity: 1 }, { quantity: 1 }], artworks: files.slice(0, 1) });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.at(-1).message, /2 items but 1 artworks/);
});

test("builds import-template rows with the R2 artwork URL", () => {
  const order = {
    orderNumber: "PB-IMPORT",
    shippingMethod: "STANDARD SHIPPING",
    shippingName: "Example Customer",
    shippingAddress1: "1 Main St",
    city: "Austin",
    province: "TX",
    countryCode: "US",
    zip: "78701",
    items: [{
      productCodeSource: "GF-20",
      title: "Flower Pot",
      quantity: 1,
      sizeRaw: "",
      artwork: { publicUrl: "https://artwork.example.com/artwork/test.png" }
    }]
  };
  const result = buildImportRows([order], { ...sampleCatalog, spus: [{ spu: "UFP", name: "Flower Pot", skuPrefixes: ["GF"] }] }, "http://localhost:3000");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0][0], "PB-IMPORT");
  assert.equal(result.rows[0][16], "https://artwork.example.com/artwork/test.png");
});
