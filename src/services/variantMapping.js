import ExcelJS from "exceljs";

function clean(value) {
  return String(value ?? "").replace(/[\u00ad\u00a0]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function prefixesForRule(value) {
  return clean(value).split(",").map((prefix) => normalizeToken(prefix)).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeVariantRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => ({
      spu: clean(rule?.spu),
      skuPrefix: clean(rule?.skuPrefix),
      size: clean(rule?.size),
      color: clean(rule?.color),
      productCode: clean(rule?.productCode)
    }))
    .filter((rule) => rule.spu && rule.productCode);
}

function ruleMatches(rule, { spu, sourceSku, size, color, ignoreSize = false }) {
  if (normalizeToken(rule.spu) !== normalizeToken(spu)) return false;
  const normalizedSource = normalizeToken(sourceSku);
  const prefixes = prefixesForRule(rule.skuPrefix);
  if (prefixes.length && !prefixes.some((prefix) => normalizedSource.startsWith(prefix))) return false;
  if (!ignoreSize && rule.size && normalizeToken(rule.size) !== normalizeToken(size)) return false;
  if (rule.color && normalizeToken(rule.color) !== normalizeToken(color)) return false;
  return true;
}

function rankCandidates(candidates) {
  return candidates
    .sort((left, right) => {
      const leftPrefix = Math.max(0, ...prefixesForRule(left.skuPrefix).map((prefix) => prefix.length));
      const rightPrefix = Math.max(0, ...prefixesForRule(right.skuPrefix).map((prefix) => prefix.length));
      const leftSpecificity = (leftPrefix ? 1000 + leftPrefix : 0) + (left.size ? 10 : 0) + (left.color ? 5 : 0);
      const rightSpecificity = (rightPrefix ? 1000 + rightPrefix : 0) + (right.size ? 10 : 0) + (right.color ? 5 : 0);
      return rightSpecificity - leftSpecificity;
    });
}

export function findVariantProductCode(item, { spu, mappedSize, mappedColor, catalog }) {
  const rules = normalizeVariantRules(catalog?.variantRules);
  const matchContext = { spu, sourceSku: item.productCodeSource, size: mappedSize, color: mappedColor };
  const candidates = rankCandidates(rules
    .filter((rule) => ruleMatches(rule, {
      ...matchContext
    })));
  if (candidates.length) return candidates[0].productCode;

  // Some products do not print a size in the source PDF. If there is exactly
  // one Product_Code rule for the SPU/prefix/color, use that rule and preserve
  // its configured output size instead of falling back to `SPU/color`.
  if (!normalizeToken(mappedSize)) {
    const sizeFallback = rankCandidates(rules.filter((rule) => ruleMatches(rule, { ...matchContext, ignoreSize: true })));
    const productCodes = new Set(sizeFallback.map((rule) => normalizeToken(rule.productCode)));
    if (productCodes.size === 1) return sizeFallback[0]?.productCode || "";
  }
  return "";
}

export function parseExportProductCode(spu, productCode) {
  const normalizedSpu = clean(spu);
  const normalizedCode = clean(productCode);
  if (!normalizedSpu || !normalizedCode) return null;
  const match = normalizedCode.match(new RegExp(`^${escapeRegExp(normalizedSpu)}-(.+?)/(.+)$`, "i"));
  if (!match) return null;
  return {
    spu: normalizedSpu,
    skuPrefix: "",
    color: clean(match[1]),
    size: clean(match[2]),
    productCode: normalizedCode
  };
}

export async function parseSuccessfulExportWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet.");

  const headerRow = worksheet.getRow(1);
  const headers = new Map();
  headerRow.eachCell((cell, columnNumber) => headers.set(clean(cell.value), columnNumber));
  const spuColumn = headers.get("Product_Spu");
  const productCodeColumn = headers.get("Product_Code");
  if (!spuColumn || !productCodeColumn) {
    throw new Error("The workbook must contain Product_Spu and Product_Code columns.");
  }

  const rules = [];
  const skipped = [];
  const seen = new Set();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const spu = clean(row.getCell(spuColumn).value);
    const productCode = clean(row.getCell(productCodeColumn).value);
    if (!spu && !productCode) continue;
    const parsed = parseExportProductCode(spu, productCode);
    if (!parsed) {
      skipped.push({ row: rowNumber, productCode, message: "Product_Code does not match SPU-color/size format." });
      continue;
    }
    const key = [parsed.spu, parsed.skuPrefix, parsed.size, parsed.color, parsed.productCode].map(normalizeToken).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      rules.push(parsed);
    }
  }
  return { rules, skipped, rowsRead: worksheet.rowCount - 1 };
}
