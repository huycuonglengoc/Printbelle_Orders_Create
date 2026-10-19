import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { buildAllPayloads } from "./orderBuilder.js";

const TEMPLATE_COLUMNS = [
  "*Order Id", "*Shipping method", "*Sellers item sku", "*Product Code", "*Quantity",
  "*Shipping name", "*Shipping address1", "Shipping address2", "*Shipping city",
  "*Shipping province", "*Shipping country code", "*Shipping zip", "Shipping phone1",
  "Shipping phone2", "Email", "Url Mockup", "*Artwork", "Shape", "Remark"
];

export function buildImportRows(orders, catalog, artworkBaseUrl) {
  const built = buildAllPayloads(orders, catalog, artworkBaseUrl);
  const skipped = built.filter((entry) => entry.skipped).map((entry) => ({
    orderId: entry.order.orderNumber,
    errors: entry.errors
  }));
  const rows = [];
  for (const entry of built.filter((candidate) => !candidate.skipped)) {
    for (const item of entry.payload.items) {
      rows.push([
        entry.payload.orderId,
        entry.payload.shippingMethod,
        item.sellersItemSku,
        item.productCode,
        item.quantity,
        entry.payload.shippingName,
        entry.payload.shippingAddress1,
        entry.payload.shippingAddress2 || null,
        entry.payload.shippingCity,
        entry.payload.shippingProvince,
        entry.payload.shippingCountryCode,
        entry.payload.shippingZip,
        entry.order.shippingPhone1 || null,
        entry.order.shippingPhone2 || null,
        entry.payload.email || null,
        null,
        item.artwork,
        null,
        item.lineItemSku || null
      ]);
    }
  }
  return { rows, skipped, built, headers: TEMPLATE_COLUMNS };
}

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

export async function createImportWorkbook(rows, templatePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await fs.readFile(templatePath));
  const worksheet = workbook.getWorksheet("order_import_template") || workbook.worksheets[0];
  if (!worksheet) throw new Error("The order import template does not contain a worksheet.");

  const templateRow = worksheet.getRow(2);
  const rowStyles = Array.from({ length: TEMPLATE_COLUMNS.length }, (_, index) => cloneStyle(templateRow.getCell(index + 1).style));
  const templateHeight = templateRow.height;
  // The supplied workbook uses rows 2-4 as examples. Clear those rows first,
  // then insert any additional export rows below them so the instruction area
  // and the Country Code sheet remain intact.
  for (let rowNumber = 2; rowNumber <= 4; rowNumber += 1) worksheet.getRow(rowNumber).values = [];
  if (rows.length > 3) worksheet.insertRows(5, rows.slice(3));
  rows.forEach((_, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 2);
    row.values = rows[rowIndex];
    row.height = templateHeight;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (rowStyles[columnNumber - 1]) cell.style = cloneStyle(rowStyles[columnNumber - 1]);
    });
  });
  worksheet.autoFilter = { from: "A1", to: `S${Math.max(1, rows.length + 1)}` };
  return workbook.xlsx.writeBuffer();
}
