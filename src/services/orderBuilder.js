import { normalizeKey } from "./orderParser.js";
import { findVariantProductCode } from "./variantMapping.js";
import { skuPrefixMatches, splitSkuPrefixes } from "./skuPrefix.js";

const DEFAULT_SHIPPING_METHOD = "STANDARD SHIPPING-USPS";
const BULK_SHIPPING_METHOD = "FAST   SHIPPING";

function totalItemQuantity(order) {
  return (order.items || []).reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0);
}

function shippingMethodForOrder(order) {
  if (totalItemQuantity(order) >= 10) return BULK_SHIPPING_METHOD;
  return order.shippingMethod || DEFAULT_SHIPPING_METHOD;
}

function normalizeSize(value) {
  return normalizeKey(value).replace(/x/g, "x");
}

function findSpu(item, catalog) {
  const haystack = normalizeKey(`${item.productCodeSource} ${item.title}`);
  const values = (value) => Array.isArray(value) ? value : String(value || "").split(",");
  const prefixCandidate = (catalog.spus || []).find((entry) => values(entry.skuPrefixes).some((prefix) => skuPrefixMatches(item.productCodeSource, prefix)));
  const aliasCandidate = (catalog.spus || []).find((entry) => values(entry.aliases).some((alias) => haystack.includes(normalizeKey(alias))));
  const candidate = prefixCandidate || aliasCandidate;
  return candidate?.spu || "";
}

function rulesForProduct(rules, productCode) {
  const normalizedProductCode = normalizeKey(productCode);
  const entries = Object.entries(rules || {});
  const prefixesForKey = (key) => splitSkuPrefixes(key);
  const exact = entries.find(([key]) => prefixesForKey(key).some((part) => part === normalizedProductCode));
  if (exact) return exact[1] || {};

  // Keep exact product-code mappings working, while allowing a prefix such as
  // GF to cover GF-10, GF-20, and future SKU variants. Prefer the longest
  // matching prefix when rules overlap (for example G and GF).
  const prefix = entries
    .map(([key, value]) => ({ value, longestPrefix: Math.max(0, ...prefixesForKey(key).map((part) => part.length)), prefixes: prefixesForKey(key) }))
    .filter((entry) => entry.longestPrefix && entry.prefixes.some((prefix) => skuPrefixMatches(productCode, prefix)))
    .sort((left, right) => right.longestPrefix - left.longestPrefix)[0];
  return prefix?.value || {};
}

function mapSize(item, catalog) {
  const rules = rulesForProduct(catalog.sizeMappings, item.productCodeSource);
  const exact = Object.entries(rules).find(([source]) => normalizeSize(source) === normalizeSize(item.sizeRaw))?.[1];
  if (exact) return exact;
  if (item.sizeRaw) return item.sizeRaw;

  const defaults = (catalog.defaultSizeRules || [])
    .filter((rule) => splitSkuPrefixes(rule?.skuPrefix).some((prefix) => skuPrefixMatches(item.productCodeSource, prefix)) && rule?.size)
    .sort((left, right) => {
      const leftPrefix = Math.max(0, ...splitSkuPrefixes(left.skuPrefix).map((prefix) => prefix.length));
      const rightPrefix = Math.max(0, ...splitSkuPrefixes(right.skuPrefix).map((prefix) => prefix.length));
      return rightPrefix - leftPrefix;
    });
  return defaults[0]?.size || "";
}

function mapColor(item, catalog) {
  const rules = rulesForProduct(catalog.colorMappings, item.productCodeSource);
  const mapped = Object.entries(rules).find(([source]) => normalizeKey(source) === normalizeKey(item.color))?.[1];
  return mapped || item.color || "";
}

function buildVariantCode(item, spu, mappedSize, mappedColor, catalog) {
  const key = [item.productCodeSource, mappedSize, mappedColor].map(normalizeKey).join("|");
  const explicit = catalog.variantMappings?.[key] || catalog.variantMappings?.[item.productCodeSource];
  if (explicit) return explicit;
  const variant = mappedSize || mappedColor;
  return variant ? `${spu}/${variant}` : spu;
}

export function buildPrintbellePayload(order, catalog, artworkBaseUrl) {
  const warnings = [...(order.warnings || [])];
  const errors = [...(order.errors || [])];
  const items = [];
  let artworkIndex = 0;
  for (const item of order.items || []) {
    const spu = item.spu || findSpu(item, catalog);
    const mappedSize = item.sizeTarget || mapSize(item, catalog);
    const mappedColor = item.colorTarget || mapColor(item, catalog);
    const mappedProductCode = findVariantProductCode(item, { spu, mappedSize, mappedColor, catalog });
    const productCode = item.productCodeTarget || mappedProductCode || buildVariantCode(item, spu, mappedSize, mappedColor, catalog);
    if (!spu) errors.push({ message: `${item.productCodeSource}: no SPU is configured.`, type: "spu" });
    const hasSizeMapping = Object.keys(rulesForProduct(catalog.sizeMappings, item.productCodeSource)).some((source) => normalizeSize(source) === normalizeSize(item.sizeRaw));
    if (item.sizeRaw && !item.sizeTarget && !hasSizeMapping) {
      errors.push({ message: `${item.productCodeSource}: no size mapping exists for “${item.sizeRaw}”.`, type: "size" });
    }
    const artworkFile = item.artwork || (order.items.length === 1 ? order.artworks?.[0] : null);
    const artwork = artworkFile?.publicUrl || (artworkFile?.urlPath ? `${artworkBaseUrl}${artworkFile.urlPath}` : "");
    if (!artwork) errors.push({ message: `${item.productCodeSource}: no artwork URL is available.`, type: "artwork" });
    items.push({
      sellersItemSku: `${order.orderNumber}-${String(artworkIndex + 1).padStart(2, "0")}`,
      productSpu: spu,
      productCode,
      productName: item.title,
      quantity: item.quantity,
      artwork,
      // Keep the mapped values in the preview and request. Printbelle uses
      // productCode for the variant, while some account versions also accept
      // these explicit convenience fields.
      color: mappedColor,
      size: mappedSize,
      lineItemSku: item.personalization || undefined
    });
    artworkIndex += 1;
  }
  return {
    payload: {
      orderId: order.orderNumber,
      shippingMethod: shippingMethodForOrder(order),
      shippingName: order.shippingName,
      shippingAddress1: order.shippingAddress1,
      shippingAddress2: order.shippingAddress2,
      shippingCity: order.city,
      shippingProvince: order.province,
      shippingCountryCode: order.countryCode || "US",
      shippingZip: order.zip,
      email: order.email || "",
      items
    },
    warnings,
    errors,
    valid: errors.length === 0
  };
}

export function buildAllPayloads(orders, catalog, artworkBaseUrl) {
  return orders.map((order) => {
    const result = buildPrintbellePayload(order, catalog, artworkBaseUrl);
    return { order, ...result, skipped: !result.valid };
  });
}
