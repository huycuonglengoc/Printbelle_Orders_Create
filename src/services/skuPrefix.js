export function normalizeSkuToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function skuPrefixMatches(productCode, prefix) {
  const normalizedProductCode = normalizeSkuToken(productCode);
  const normalizedPrefix = normalizeSkuToken(prefix);
  return Boolean(normalizedPrefix && normalizedProductCode.startsWith(normalizedPrefix));
}

export function splitSkuPrefixes(value) {
  return String(value || "").split(",").map(normalizeSkuToken).filter(Boolean);
}
