import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u00ad\u00a0\u00ac]/g, " ")
    .replace(/[­]/g, "-")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function linesFromItems(items) {
  const rows = [];
  for (const item of items) {
    const text = normalizeText(item.str);
    if (!text) continue;
    const y = Math.round(item.transform?.[5] || 0);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: item.transform?.[4] || 0, text });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function extractPdfPages(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({ pageNumber, lines: linesFromItems(content.items) });
  }
  return pages;
}
