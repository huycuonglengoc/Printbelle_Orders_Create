import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { matchArtworks, parseOrders, parsePageLines } from "../src/services/orderParser.js";
import { buildAllPayloads } from "../src/services/orderBuilder.js";
import { buildImportRows } from "../src/services/orderImportExporter.js";
import { assignArtworks } from "../src/services/artworkAssignment.js";
import ExcelJS from "exceljs";
import { parseExportProductCode, parseSuccessfulExportWorkbook } from "../src/services/variantMapping.js";

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

test("matches SKU prefixes separated by hyphen or underscore", () => {
  const makeOrder = (productCode) => ({ orderNumber: `PB-PREFIX-${productCode}`, items: [{ productCodeSource: productCode, title: "Flower Pot", quantity: 1, sizeRaw: '2x2x3' }], artworks: [{ urlPath: "/flower.png" }] });
  const catalog = {
    ...sampleCatalog,
    spus: [{ spu: "UFP", name: "Flower Pot", skuPrefixes: ["GF-"] }],
    sizeMappings: { "GF_": { "2x2x3": "Small" } },
    variantRules: [{ spu: "UFP", skuPrefix: "GF-", size: "Small", productCode: "UFP-SMALL" }]
  };
  for (const productCode of ["GF-20", "GF_20"]) {
    const [built] = buildAllPayloads([makeOrder(productCode)], catalog, "http://localhost:3000");
    assert.equal(built.payload.items[0].productSpu, "UFP");
    assert.equal(built.payload.items[0].size, "Small");
    assert.equal(built.payload.items[0].productCode, "UFP-SMALL");
    assert.equal(built.skipped, false);
  }
});

test("prefers a clear product name over a stale SKU prefix", () => {
  const order = {
    orderNumber: "PB-SPU-NAME",
    items: [{ productCodeSource: "SC-10", title: "Butterfly Suncatcher with Custom Name", quantity: 1, sizeRaw: "" }],
    artworks: [{ urlPath: "/suncatcher.png" }]
  };
  const catalog = {
    ...sampleCatalog,
    spus: [
      { spu: "UJBOX", name: "Jewelry Storage", skuPrefixes: ["SC"] },
      { spu: "USC", name: "SunCatcher", aliases: ["suncatcher"] }
    ]
  };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].productSpu, "USC");
});

test("maps sizes by SKU prefix", () => {
  const order = { orderNumber: "PB-SIZE-PREFIX", items: [{ productCodeSource: "GF-20", title: "Flower Pot", quantity: 1, sizeRaw: '2"x2"x3' }], artworks: [{ urlPath: "/flower.png" }] };
  const payloads = buildAllPayloads([order], { ...sampleCatalog, sizeMappings: { GF: { "2x2x3": "Small" } }, spus: [{ spu: "UFP", name: "Flower Pot", skuPrefixes: ["GF"] }] }, "http://localhost:3000");
  assert.equal(payloads[0].payload.items[0].size, "Small");
  assert.equal(payloads[0].skipped, false);
});

test("maps sizes by multiple comma-separated SKU prefixes", () => {
  const order = { orderNumber: "PB-SIZE-MULTI-PREFIX", items: [{ productCodeSource: "JS-3", title: "Jewelry Storage", quantity: 1, sizeRaw: '2"x2"x3' }], artworks: [{ urlPath: "/storage.png" }] };
  const catalog = { ...sampleCatalog, sizeMappings: { "GF, JS": { "2x2x3": "5X5X4CM" } }, spus: [{ spu: "UJBOX", name: "Jewelry Storage", skuPrefixes: ["JS"] }] };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].size, "5X5X4CM");
  assert.equal(built.skipped, false);
});

test("parses Jewelry Storage color and personalization", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Jewelry Storage/input.pdf"));
  const [order] = await parseOrders(pdf, []);
  assert.equal(order.shippingAddress2, "");
  assert.equal(order.items[0].productCodeSource, "JS-3");
  assert.equal(order.items[0].color, "Blue");
  assert.equal(order.items[0].personalization, "Iona");
});

test("parses underscore SKU and Choose Your Size options", () => {
  const page = parsePageLines([
    "Ship To: Example Customer Order #PB-SUNCATCHER",
    "1 Main Street",
    "Date 01/01/2026",
    "Example City, IL 60477",
    "User example",
    "Qty Item Description Price",
    "1 Retirement Gift for Her, Butterfly Suncatcher $45.98",
    "SC_10",
    "with Custom Name and Quote (SC_10)",
    "Choose Your Size: 7.9in/20cm (Popular)",
    "Personalization: Kathy",
    "Total"
  ], 1);
  assert.equal(page.items[0].sourceSku, "SC-10");
  assert.equal(page.items[0].productCodeSource, "SC-10");
  assert.equal(page.items[0].sizeRaw, "7.9in/20cm");
  assert.equal(page.items[0].personalization, "Kathy");
});

test("stops Flower Pot size before Color Options", () => {
  const page = parsePageLines([
    "Ship To: Flower Pot Customer Order #PB-FLOWER-POT",
    "1 Main Street",
    "Date 01/01/2026",
    "Las Vegas, NV 89139",
    "User example",
    "Qty Item Description Price",
    "1 Godmother Proposal Gift, Personalized Photo",
    "GP20",
    "Glass Flower Pot, Will You Be My Godmother Keepsake (GP20)",
    "Size Options: Large",
    "Color Options: Pink",
    "Personalization: Sophia's Godmother",
    "Total"
  ], 1);
  assert.equal(page.items[0].productCodeSource, "GP-20");
  assert.equal(page.items[0].sizeRaw, "Large");
  assert.equal(page.items[0].color, "Pink");
});

test("parses items without a printed price using the following SKU line", () => {
  const page = parsePageLines([
    "Ship To: Example Customer Order #PB-JEWELRY",
    "1 Main Street",
    "Date 01/01/2026",
    "Example City, NV 89139",
    "User example",
    "Qty Item Description Price",
    "1 Personalized Floral Velvet Jewelry Box,",
    "JEW9",
    "Daughter Birthday Gift, Milestone Birthday Keepsake (JEW9)",
    "Jewelry Box Options: Pink",
    "Personalization: Mia",
    "Font Options: 6",
    "Graphic Options: 9",
    "Total"
  ], 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].productCodeSource, "JEW-9");
  assert.equal(page.items[0].color, "Pink");
  assert.equal(page.items[0].personalization, "Mia");
});

test("parses Canadian addresses and Notebooks Colors", () => {
  const page = parsePageLines([
    "Ship To: Canadian Customer Order #PB-CA",
    "30 Central Ave",
    "Date 01/01/2026",
    "Elliot Lake, ON P5A 2G1",
    "CA User example",
    "Qty Item Description Price",
    "1 Custom Letters to My Little Boy Leather",
    "NB15",
    "Notebook, New Mom Keepsake Journal, Gift for Mom (NB15)",
    "Notebooks Colors: Brown",
    "Personalization: Liam",
    "Total"
  ], 1);
  assert.equal(page.city, "Elliot Lake");
  assert.equal(page.province, "ON");
  assert.equal(page.zip, "P5A 2G1");
  assert.equal(page.countryCode, "CA");
  assert.equal(page.items[0].color, "Brown");
});

test("parses Swiss addresses with postal code before CH", () => {
  const page = parsePageLines([
    "Ship To: Swiss Customer Order #PB-CH",
    "Via Campeun 32",
    "Date 01/01/2026",
    "Rhäzüns, 7403 CH",
    "User example",
    "Qty Item Description Price",
    "1 Personalized Floral Velvet Jewelry Box,",
    "JEW9",
    "Daughter Birthday Gift (JEW9)",
    "Jewelry Box Options: Pink",
    "Total"
  ], 1);
  assert.equal(page.city, "Rhäzüns");
  assert.equal(page.province, "");
  assert.equal(page.zip, "7403");
  assert.equal(page.countryCode, "CH");
  assert.equal(page.shippingAddress2, "");
});

test("merges a wrapped US ZIP+4 suffix from the next line", () => {
  const page = parsePageLines([
    "Ship To: felicia b graham Order #4213405104",
    "2932 GARFIELD TER NW",
    "Date 10/25/2026",
    "WASHINGTON, DC 20008",
    "3507 US",
    "User 1109933771",
    "Ship Date",
    "Qty Item Description Price",
    "1 Personalized Floral Jewelry Box with Drawer, $59.98",
    "S1",
    "Wildflower Jewelry Organizer with Custom Name (S1)",
    "COLOR OPTIONS: Green",
    "Total"
  ], 2);
  assert.equal(page.orderNumber, "4213405104");
  assert.equal(page.city, "WASHINGTON");
  assert.equal(page.province, "DC");
  assert.equal(page.zip, "20008-3507");
  assert.equal(page.countryCode, "US");
  assert.equal(page.shippingAddress2, "");
});

test("merges a wrapped ZIP+4 when User metadata is on the city line", () => {
  const page = parsePageLines([
    "Ship To: Marilyn Penna Order #4210285367",
    "2360 SEVEN MILE FERRY",
    "Date 10/24/2026",
    "R D",
    "CLARKSVILLE, TN 37040 User 36154818",
    "8013 US Ship Date",
    "Qty Item Description Price",
    "1 Personalized Floral Jewelry Box with Drawer, $59.98",
    "S1",
    "Wildflower Jewelry Organizer with Custom Name (S1)",
    "COLOR OPTIONS: Green",
    "Total"
  ], 1);
  assert.equal(page.orderNumber, "4210285367");
  assert.equal(page.shippingAddress1, "2360 SEVEN MILE FERRY R D");
  assert.equal(page.city, "CLARKSVILLE");
  assert.equal(page.province, "TN");
  assert.equal(page.zip, "37040-8013");
  assert.equal(page.countryCode, "US");
  assert.equal(page.shippingAddress2, "");
});

test("merges a wrapped nine-digit ZIP when User metadata is on the city line", () => {
  const page = parsePageLines([
    "Ship To: Susana Alejandra Peralta Order #4213729486",
    "6349 MIDDLETON ST",
    "Date 10/26/2026",
    "C",
    "HUNTINGTON PK, CA User 953640612",
    "902553817 US Ship Date",
    "Qty Item Description Price",
    "1 Personalized Floral Jewelry Box with Drawer, $59.98",
    "S1",
    "Wildflower Jewelry Organizer with Custom Name (S1)",
    "COLOR OPTIONS: Green",
    "Total"
  ], 1);
  assert.equal(page.shippingAddress1, "6349 MIDDLETON ST C");
  assert.equal(page.city, "HUNTINGTON PK");
  assert.equal(page.province, "CA");
  assert.equal(page.zip, "90255-3817");
  assert.equal(page.countryCode, "US");
  assert.equal(page.shippingAddress2, "");
});

test("keeps one bulk item and raises quantity to the artwork count", async () => {
  const pdf = await fs.readFile(path.join(root, "Order/Notebook/input.pdf"));
  const artworks = [
    ...Array.from({ length: 37 }, (_, index) => ({ originalname: `${index + 1}_Stacey Wierman_${index}_jb.png`, urlPath: `/stacey-${index}.png` })),
    { originalname: "38_Jordan Axenfeld_0_jb - Copy.png", urlPath: "/jordan.png" }
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

test("partitions artworks across separate orders with the same customer name", () => {
  const orders = [
    { orderNumber: "PB-SAME-NAME-1", shippingName: "Meghan Nagle", items: [{ quantity: 1 }] },
    { orderNumber: "PB-SAME-NAME-2", shippingName: "Meghan Nagle", items: [{ quantity: 1 }] }
  ];
  const matched = matchArtworks(orders, [
    { originalname: "1_Meghan Nagle_0.png", urlPath: "/meghan-1.png" },
    { originalname: "2_Meghan Nagle_0.png", urlPath: "/meghan-2.png" }
  ]);
  assert.deepEqual(matched.map((order) => order.artworks.map((file) => file.filename)), [
    ["1_Meghan Nagle_0.png"],
    ["2_Meghan Nagle_0.png"]
  ]);
  assert.deepEqual(matched.map((order) => order.items[0].quantity), [1, 1]);
  assert.deepEqual(matched.map((order) => order.valid), [true, true]);
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

test("maps combined Product_Code rules imported from a successful export", () => {
  const order = {
    orderNumber: "PB-VARIANT",
    items: [{ productCodeSource: "EJ-7", title: "Notebook", quantity: 1, sizeRaw: "", sizeTarget: "5.8X8.5INCH", color: "Pink" }],
    artworks: [{ urlPath: "/notebook.png" }]
  };
  const catalog = {
    ...sampleCatalog,
    spus: [{ spu: "ULCNP", name: "Notebook", aliases: ["notebook"] }],
    variantRules: [{ spu: "ULCNP", skuPrefix: "", size: "5.8X8.5INCH", color: "Pink", productCode: "ULCNP-Pink/5.8X8.5INCH" }]
  };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].productCode, "ULCNP-Pink/5.8X8.5INCH");
});

test("uses a unique sized Product_Code rule when the PDF has no size", () => {
  const order = {
    orderNumber: "PB-VARIANT-NO-SIZE",
    items: [{ productCodeSource: "EJ-7", title: "Notebook", quantity: 1, sizeRaw: "", color: "Green" }],
    artworks: [{ urlPath: "/notebook.png" }]
  };
  const catalog = {
    ...sampleCatalog,
    spus: [{ spu: "ULCNP", name: "Notebook", aliases: ["notebook"] }],
    variantRules: [{ spu: "ULCNP", skuPrefix: "EJ-7", size: "5.8X8.5INCH", color: "Green", productCode: "ULCNP-Green/5.8X8.5INCH" }]
  };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].productCode, "ULCNP-Green/5.8X8.5INCH");
});

test("uses a configured default size for a SKU prefix when PDF size is blank", () => {
  const order = {
    orderNumber: "PB-DEFAULT-SIZE",
    items: [{ productCodeSource: "EJ-7", title: "Notebook", quantity: 1, sizeRaw: "", color: "Green" }],
    artworks: [{ urlPath: "/notebook.png" }]
  };
  const catalog = {
    ...sampleCatalog,
    spus: [{ spu: "ULCNP", name: "Notebook", skuPrefixes: ["EJ"] }],
    defaultSizeRules: [{ skuPrefix: "EJ-7, GF", size: "5.8X8.5INCH" }],
    variantRules: [{ spu: "ULCNP", skuPrefix: "EJ-7", size: "5.8X8.5INCH", color: "Green", productCode: "ULCNP-Green/5.8X8.5INCH" }]
  };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].size, "5.8X8.5INCH");
  assert.equal(built.payload.items[0].productCode, "ULCNP-Green/5.8X8.5INCH");
});

test("supports multiple SKU prefixes in one Product_Code rule", () => {
  const order = {
    orderNumber: "PB-MULTI-PREFIX",
    items: [{ productCodeSource: "JS-3", title: "Jewelry Storage", quantity: 1, color: "Green", sizeRaw: "" }],
    artworks: [{ urlPath: "/storage.png" }]
  };
  const catalog = {
    ...sampleCatalog,
    spus: [{ spu: "UJBOX", name: "Jewelry Storage", skuPrefixes: ["JS"] }],
    variantRules: [{ spu: "UJBOX", skuPrefix: "GF, JS", color: "Green", productCode: "UJBOX-Green/DEFAULT" }]
  };
  const [built] = buildAllPayloads([order], catalog, "http://localhost:3000");
  assert.equal(built.payload.items[0].productCode, "UJBOX-Green/DEFAULT");
});

test("stops color parsing before font options", () => {
  const page = parsePageLines([
    "Ship To: Example Customer Order #PB-COLOR",
    "1 Main Street",
    "Date 01/01/2026",
    "Example City, TX 78701",
    "User example",
    "Qty Item Description",
    "1 EJ-7 Custom Notebook $10.00",
    "Journal Color Options: Green Font Options: Font 2 PERSONALIZATION: Example",
    "Total"
  ], 1);
  assert.equal(page.items[0].color, "Green");
});

test("selects shipping method from total item quantity", () => {
  const makeOrder = (quantity) => ({ orderNumber: `PB-SHIPPING-${quantity}`, items: [{ productCodeSource: "EJ-7", title: "Notebook", quantity, sizeRaw: "" }], artworks: [{ urlPath: "/notebook.png" }] });
  const catalog = { ...sampleCatalog, spus: [{ spu: "ULCNP", name: "Notebook", skuPrefixes: ["EJ"] }] };
  assert.equal(buildAllPayloads([makeOrder(9)], catalog, "http://localhost:3000")[0].payload.shippingMethod, "STANDARD SHIPPING-USPS");
  assert.equal(buildAllPayloads([makeOrder(10)], catalog, "http://localhost:3000")[0].payload.shippingMethod, "FAST   SHIPPING");
});

test("parses successful export Product_Code values into reusable rules", async () => {
  assert.deepEqual(parseExportProductCode("ULCNP", "ULCNP-Pink/5.8X8.5INCH"), {
    spu: "ULCNP",
    skuPrefix: "",
    size: "5.8X8.5INCH",
    color: "Pink",
    productCode: "ULCNP-Pink/5.8X8.5INCH"
  });
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("export");
  worksheet.addRow(["Product_Spu", "Product_Code"]);
  worksheet.addRow(["ULCNP", "ULCNP-Pink/5.8X8.5INCH"]);
  worksheet.addRow(["ULCNP", "ULCNP-Green/5.8X8.5INCH"]);
  const parsed = await parseSuccessfulExportWorkbook(await workbook.xlsx.writeBuffer());
  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.skipped.length, 0);
  assert.equal(parsed.rules[1].color, "Green");
});
