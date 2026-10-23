import path from "node:path";
import { extractPdfPages } from "./pdfParser.js";
import { assignArtworks } from "./artworkAssignment.js";

function clean(value) {
  return String(value || "").replace(/[\u00ad\u00a0]/g, " ").replace(/[­]/g, "-").replace(/\s+/g, " ").trim();
}

function canonicalProductCode(value) {
  const compact = clean(value).replace(/\s+/g, "").toUpperCase();
  return compact.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/["'’`]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function parseCityLine(lines, startIndex) {
  const candidate = lines.slice(startIndex).join(" ").replace(/(\d{5})\s+(\d{4})(?=\s+(?:US|User)\b)/g, "$1-$2");
  const match = candidate.match(/([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-?\s*\d{4})?)/i);
  if (!match) return { city: "", province: "", zip: "", countryCode: "US" };
  const zipDigits = match[3].replace(/\s|-/g, "");
  return { city: clean(match[1]), province: match[2].toUpperCase(), zip: zipDigits.length === 9 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5)}` : zipDigits, countryCode: "US" };
}

function parseShipping(lines, headerIndex) {
  const header = lines[headerIndex] || "";
  const headerMatch = header.match(/Ship To:\s*(.*?)\s+Order\s*#\s*([\w-]+)/i);
  const shippingName = clean(headerMatch?.[1] || "");
  const orderNumber = headerMatch?.[2] || "";
  const dateIndex = lines.findIndex((line, index) => index > headerIndex && /\bDate\b/i.test(line));
  const beforeDate = lines.slice(headerIndex + 1, dateIndex > -1 ? dateIndex : headerIndex + 4);
  const address1 = clean(beforeDate.find((line) => line && !/^Date\b/i.test(line)) || "");
  const afterDate = dateIndex > -1 ? lines.slice(dateIndex + 1, dateIndex + 7) : [];
  const userLineIndex = afterDate.findIndex((line) => /\bUser\b/i.test(line));
  const userLine = userLineIndex > -1 ? afterDate[userLineIndex] : afterDate.at(-1) || "";
  const userMatch = userLine.match(/\bUser\s+([\w-]+)/i);
  const cityStart = afterDate.findIndex((line) => /,\s*[A-Z]{2}\b/i.test(line));
  const location = parseCityLine(afterDate, cityStart > -1 ? cityStart : 0);
  const address2Lines = afterDate.slice(0, cityStart > -1 ? cityStart : userLineIndex > -1 ? userLineIndex : afterDate.length)
    .filter((line) => line && !/^US\b/i.test(line) && !/^Ship Date/i.test(line));
  return {
    shippingName,
    orderNumber,
    userId: userMatch?.[1] || "",
    shippingAddress1: address1,
    shippingAddress2: clean(address2Lines.join(" ")),
    ...location
  };
}

function parseItem(lines, itemStart, nextItemStart = -1) {
  const first = lines[itemStart] || "";
  const match = first.match(/^(\d+)\s+([\w-]+)\s+(.+?)(?:\s*\|\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/);
  const shortPriceMatch = first.match(/^(\d+)\s+\(?\$\s*([\d,]+(?:\.\d{1,2})?)\)?$/);
  if (!match && !shortPriceMatch) return null;
  const quantity = Number(match?.[1] || shortPriceMatch[1]);
  const standaloneSku = lines[itemStart + 1]?.match(/^[A-Z0-9-]{3,}$/i)?.[0];
  const inlineSku = !match ? lines[itemStart + 1]?.match(/^([A-Z0-9-]{3,})(?:\s|$)/i)?.[1] : "";
  const skuLine = standaloneSku || inlineSku;
  const sourceSku = canonicalProductCode(skuLine || match?.[2] || "");
  const titleParts = match ? [standaloneSku ? `${match[2]} ${match[3]}` : match[3]] : [];
  const skipStandaloneSkuLine = Boolean(match && standaloneSku);
  let cursor = itemStart + 1;
  while (cursor < lines.length && (nextItemStart < 0 || cursor < nextItemStart) && !/^(?:Size Options|Choose Your Color|Journal Color Options|PERSONALIZATION|Personalization|Add personalization|Choose a font|Choose font color|Choice Graphic Options|\d+\s+Discount|Sub Total|Tax|Shipping|Total|Note:)/i.test(lines[cursor])) {
    if (skipStandaloneSkuLine && cursor === itemStart + 1) {
      cursor += 1;
      continue;
    }
    if (/\([^()]{1,20}\)/.test(lines[cursor])) {
      titleParts.push(lines[cursor]);
      break;
    }
    if (titleParts.join(" ").includes("|") && !/^\w+\s+/.test(lines[cursor])) break;
    titleParts.push(lines[cursor]);
    cursor += 1;
  }
  const summaryEnd = lines.findIndex((line, index) => index > itemStart && /^(?:\d+\s+Discount|Sub Total|Tax|Shipping|Total|Note:)/i.test(line));
  const itemEnd = nextItemStart > -1 ? nextItemStart : summaryEnd;
  const optionLines = lines.slice(itemStart, itemEnd > -1 ? itemEnd : Math.min(lines.length, itemStart + 16));
  const fullItemText = optionLines.join(" ");
  const codeMatch = fullItemText.match(/\(([A-Z0-9-]{2,}(?:\s+[A-Z0-9-]{1,})?)\)/i);
  const sizeMatch = fullItemText.match(/Size Options:\s*([^\n]+?)(?=\s+(?:Choose|PERSONALIZATION|Personalization|Note:|$))/i);
  const colorMatch = fullItemText.match(/(?:Choose Your Color Options|Choose Your Color|Choose Color Options|Journal Color Options|Color Options):\s*([^\n]+?)(?=\s+(?:PERSONALIZATION|Personalization|Add personalization|Choose a font|Choose font color|Font Options|Choice Graphic Options|Choice Graphic|Size Options|Note:|$))/i);
  const personalizationMatches = [...fullItemText.matchAll(/(?:PERSONALIZATION|Personalization|Add personalization[^:]*):\s*(.+?)(?=\s+(?:Journal Color|Choose a font|Choose font color|Choice Graphic|Size Options|Note:|$))/gi)];
  const personalization = personalizationMatches.at(-1)?.[1]?.trim() || "";
  const sizeRaw = sizeMatch?.[1]?.replace(/:?(?:Large|Small)\s*$/i, "").trim() || "";
  return {
    sourceSku,
    productCodeSource: canonicalProductCode(codeMatch?.[1] || sourceSku),
    title: clean(titleParts.join(" ") || fullItemText.split(/(?:Size Options|Choose Your Color|Journal Color Options|PERSONALIZATION|Personalization|Add personalization):/i)[0]).replace(/\s*\|\s*/g, " | "),
    quantity,
    price: Number((match?.[4] || shortPriceMatch?.[2] || "0").replace(/,/g, "")),
    sizeRaw: clean(sizeRaw),
    color: clean(colorMatch?.[1] || ""),
    personalization: clean(personalization),
    rawText: fullItemText
  };
}

function isItemStartLine(line, index, lines) {
  if (/^\d+\s+Discount\b/i.test(line)) return false;
  if (/^\d+\s+\(\s*\$/.test(line) && /^Discount$/i.test(lines[index + 1] || "")) return false;
  return /^\d+\s+.+\$\s*[\d,]+(?:\.\d{1,2})?/.test(line)
    || /^\d+\s+\(?\$\s*[\d,]+(?:\.\d{1,2})?\)?$/.test(line);
}

function applyContinuationOptions(item, lines) {
  const extraText = lines.map(clean).filter(Boolean).join(" ");
  if (!extraText) return item;
  const fullItemText = `${item.rawText} ${extraText}`;
  const colorMatch = fullItemText.match(/(?:Choose Your Color Options|Choose Your Color|Choose Color Options|Journal Color Options|Color Options):\s*([^\n]+?)(?=\s+(?:PERSONALIZATION|Personalization|Add personalization|Choose a font|Choose font color|Font Options|Choice Graphic Options|Choice Graphic|Size Options|Note:|$))/i);
  const sizeMatch = fullItemText.match(/Size Options:\s*([^\n]+?)(?=\s+(?:Choose|PERSONALIZATION|Personalization|Note:|$))/i);
  const personalizationMatches = [...fullItemText.matchAll(/(?:PERSONALIZATION|Personalization|Add personalization[^:]*):\s*(.+?)(?=\s+(?:Journal Color|Choose a font|Choose font color|Choice Graphic|Size Options|Note:|$))/gi)];
  return {
    ...item,
    sizeRaw: clean(sizeMatch?.[1]?.replace(/:?(?:Large|Small)\s*$/i, "") || item.sizeRaw),
    color: clean(colorMatch?.[1] || item.color),
    personalization: clean(personalizationMatches.at(-1)?.[1] || item.personalization),
    rawText: fullItemText
  };
}

function continuationItems(lines, currentOrder) {
  const normalized = lines.map(clean).filter(Boolean);
  const itemStarts = normalized
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => isItemStartLine(line, index, normalized))
    .map(({ index }) => index);
  const firstItemStart = itemStarts[0] ?? normalized.length;
  const leadingContinuation = normalized
    .slice(0, firstItemStart)
    .filter((line) => !/^Qty\s+Item\s+Description/i.test(line));
  if (currentOrder?.items?.length && leadingContinuation.length) {
    const lastIndex = currentOrder.items.length - 1;
    currentOrder.items[lastIndex] = applyContinuationOptions(currentOrder.items[lastIndex], leadingContinuation);
  }
  return itemStarts.map((itemStart, index) => parseItem(normalized, itemStart, itemStarts[index + 1] ?? -1)).filter(Boolean);
}

export function parsePageLines(lines, pageNumber) {
  const normalized = lines.map(clean).filter(Boolean);
  const headerIndex = normalized.findIndex((line) => /^Ship To:/i.test(line));
  if (headerIndex < 0) return null;
  const shipping = parseShipping(normalized, headerIndex);
  const tableHeaderIndex = normalized.findIndex((line, index) => index > headerIndex && /^Qty\s+Item\s+Description/i.test(line));
  const itemStarts = normalized
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > tableHeaderIndex && !/^(?:\d+\s+Discount|\d+\s+\(.*\)\s+Discount|Sub Total|Tax|Shipping|Total|Note:)/i.test(line) && isItemStartLine(line, index, normalized))
    .map(({ index }) => index);
  const items = itemStarts.map((itemStart, index) => parseItem(normalized, itemStart, itemStarts[index + 1] ?? -1)).filter(Boolean);
  return { id: `${shipping.orderNumber || "page"}-${pageNumber}`, pageNumber, ...shipping, items };
}

function matchArtworks(orders, artworkFiles) {
  const groups = new Map();
  for (const file of artworkFiles) {
    const base = path.basename(file.originalname || file.filename || "");
    const stem = base.replace(/\.(?:png|jpe?g|webp)$/i, "");
    const afterSequence = stem.replace(/^\d+_/, "");
    const customerMatch = afterSequence.match(/^(.+?)_\d+(?:_.*)?$/);
    const customerKey = normalizeKey(customerMatch?.[1] || afterSequence);
    const list = groups.get(customerKey) || [];
    list.push({ ...file, path: file.path || file.savedPath, originalname: base });
    groups.set(customerKey, list);
  }
  for (const order of orders) {
    const key = normalizeKey(order.shippingName);
    const files = groups.get(key) || [];
    files.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));
    order.artworks = files.map((file) => ({
      filename: file.originalname,
      urlPath: file.urlPath || "",
      publicUrl: file.publicUrl || "",
      storageKey: file.storageKey || ""
    }));
    if (!files.length) order.errors = [...(order.errors || []), { message: `No artwork matched ${order.shippingName}.`, type: "artwork" }];
  }
  return orders.map(assignArtworks);
}

export async function parseOrders(pdfBuffer, artworkFiles = []) {
  const pages = await extractPdfPages(pdfBuffer);
  const orders = [];
  let currentOrder = null;
  let continuationLines = [];
  const flushContinuation = () => {
    if (!currentOrder || !continuationLines.length) return;
    currentOrder.items.push(...continuationItems(continuationLines, currentOrder));
    continuationLines = [];
  };
  for (const page of pages) {
    const parsed = parsePageLines(page.lines, page.pageNumber);
    if (parsed) {
      flushContinuation();
      currentOrder = parsed;
      orders.push(parsed);
    } else if (currentOrder) {
      continuationLines.push(...page.lines);
    }
  }
  flushContinuation();
  if (!orders.length) throw new Error("No valid packing slips were found in the PDF.");
  return matchArtworks(orders, artworkFiles);
}

export { normalizeKey };
