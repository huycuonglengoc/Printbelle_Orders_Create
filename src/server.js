import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, normalizeCatalog, publicConfig } from "./config.js";
import { parseOrders } from "./services/orderParser.js";
import { buildAllPayloads } from "./services/orderBuilder.js";
import { buildImportRows, createImportWorkbook } from "./services/orderImportExporter.js";
import { createOrder, getOrders, getProducts } from "./services/printbelleClient.js";
import { r2Status, uploadArtworkToR2 } from "./services/r2Storage.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 200 } });
let liveSubmissionInProgress = false;

await fs.mkdir(config.uploadDir, { recursive: true });
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(config.uploadDir, { maxAge: "1h" }));
app.use(express.static(path.resolve("public")));
app.get("/settings", (_req, res) => res.sendFile(path.resolve("public/settings.html")));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "printbelle-order-automation" }));
app.get("/api/config", (_req, res) => res.json(publicConfig()));

app.get("/api/catalog", async (_req, res) => {
  try {
    if (!config.apiToken) return res.json({ source: "local", data: config.catalog });
    const response = await getProducts();
    res.json({ source: "printbelle", data: response });
  } catch (error) {
    res.status(502).json({ error: error.message, fallback: config.catalog });
  }
});

app.get("/api/catalog-config", (_req, res) => res.json({ catalog: config.catalog }));

app.put("/api/catalog-config", async (req, res) => {
  try {
    if (!req.body?.catalog || typeof req.body.catalog !== "object" || Array.isArray(req.body.catalog)) {
      return res.status(400).json({ error: "Invalid catalog configuration." });
    }
    const catalog = normalizeCatalog(req.body?.catalog);
    const tempPath = `${config.catalogPath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(config.catalogPath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, config.catalogPath);
    config.catalog = catalog;
    res.json({ catalog: config.catalog });
  } catch (error) {
    console.error(error);
    res.status(422).json({ error: `Could not save catalog configuration: ${error.message}` });
  }
});

app.post("/api/parse", upload.fields([{ name: "pdf", maxCount: 1 }, { name: "artworks", maxCount: 200 }]), async (req, res) => {
  try {
    const pdf = req.files?.pdf?.[0];
    if (!pdf) return res.status(400).json({ error: "Please select input.pdf." });
    const sessionId = crypto.randomUUID();
    const sessionDir = path.join(config.uploadDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    const artworkFiles = [];
    for (const file of req.files?.artworks || []) {
      const safeName = `${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._ -]/g, "_")}`;
      const urlPath = `/uploads/${sessionId}/${encodeURIComponent(safeName)}`;
      await fs.writeFile(path.join(sessionDir, safeName), file.buffer);
      const artwork = { originalname: file.originalname, urlPath, storageKey: `artwork/${sessionId}/${safeName}` };
      if (config.r2.enabled) {
        artwork.publicUrl = await uploadArtworkToR2({ key: artwork.storageKey, buffer: file.buffer, contentType: file.mimetype });
      }
      artworkFiles.push(artwork);
    }
    const orders = await parseOrders(pdf.buffer, artworkFiles);
    res.json({ sessionId, orders, warnings: orders.flatMap((order) => order.warnings || []) });
  } catch (error) {
    console.error(error);
    res.status(422).json({ error: error.message || "Could not read the PDF." });
  }
});

app.post("/api/orders/export-import", async (req, res) => {
  try {
    if (config.r2.requiredForImport && !config.r2.enabled) {
      return res.status(503).json({ error: "Cloudflare R2 is required for import export. Configure the R2 environment variables first.", r2: r2Status() });
    }
    const catalog = req.body?.catalog || config.catalog;
    const orders = req.body?.orders || [];
    const prepared = buildImportRows(orders, catalog, config.artworkBaseUrl);
    if (!prepared.rows.length) {
      return res.status(422).json({ error: "There are no valid order rows to export.", skipped: prepared.skipped });
    }
    const buffer = await createImportWorkbook(prepared.rows, config.importTemplatePath);
    const filename = `printbelle-order-import-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Printbelle-Exported-Rows": String(prepared.rows.length),
      "X-Printbelle-Skipped-Orders": String(prepared.skipped.length)
    });
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(422).json({ error: error.message || "Could not export the order import workbook." });
  }
});

app.post("/api/orders/preview", (req, res) => {
  try {
    const catalog = req.body?.catalog || config.catalog;
    const orders = req.body?.orders || [];
    res.json({ dryRun: config.dryRun, orders: buildAllPayloads(orders, catalog, config.artworkBaseUrl) });
  } catch (error) {
    res.status(422).json({ error: error.message });
  }
});

app.post("/api/orders/submit", async (req, res) => {
  const liveRequest = !config.dryRun;
  if (liveRequest && liveSubmissionInProgress) {
    return res.status(409).json({ error: "Another live submission is already in progress. Please wait for it to finish." });
  }
  if (liveRequest) liveSubmissionInProgress = true;
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirmation is required before submitting orders." });
    const built = buildAllPayloads(req.body?.orders || [], req.body?.catalog || config.catalog, config.artworkBaseUrl);
    const skipped = built.filter((entry) => entry.skipped);
    const ready = built.filter((entry) => !entry.skipped);
    if (config.dryRun) return res.json({ dryRun: true, message: "Dry-run: nothing was submitted to Printbelle.", orders: ready, skipped });
    if (!ready.length) return res.json({ dryRun: false, message: "There are no valid orders to submit.", results: [], skipped });

    // The public API exposes orderId as the merchant's custom ID. Check it first
    // so a repeated click/retry does not create the same order twice.
    const existingOrderIds = new Set();
    for (let index = 0; index < ready.length; index += 100) {
      const batch = ready.slice(index, index + 100).map((entry) => entry.order.orderNumber);
      const response = await getOrders(batch);
      for (const order of response?.data?.list || []) {
        if (order?.orderId) existingOrderIds.add(String(order.orderId));
      }
    }

    const duplicates = [];
    const results = [];
    for (const entry of ready) {
      const orderId = entry.order.orderNumber;
      if (existingOrderIds.has(String(orderId))) {
        duplicates.push({ orderId, message: "Already exists in Printbelle; not submitted again." });
        continue;
      }
      try {
        const result = await createOrder(entry.payload);
        results.push({ orderId, ok: true, result, warnings: entry.warnings });
      } catch (error) {
        results.push({ orderId, ok: false, error: error.message, details: error.details, warnings: entry.warnings });
      }
    }
    res.json({
      dryRun: false,
      message: results.every((entry) => entry.ok) ? "Order submission finished." : "Order submission finished with errors.",
      results,
      duplicates,
      skipped
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 502).json({ error: error.message, details: error.details });
  } finally {
    if (liveRequest) liveSubmissionInProgress = false;
  }
});

app.get("*", (_req, res) => res.sendFile(path.resolve("public/index.html")));

const server = app.listen(config.port, "0.0.0.0", () => console.log(`Printbelle app listening on port ${config.port}`));
function shutdown(signal) { console.log(`${signal}: shutting down`); server.close(() => process.exit(0)); }
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
