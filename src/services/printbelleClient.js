import { config } from "../config.js";

async function request(pathname, options = {}) {
  if (!config.apiToken) throw new Error("PRINTBELLE_API_TOKEN is missing from the environment.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "PB-ACCESS-TOKEN": config.apiToken, ...(options.headers || {}) }
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Printbelle API timed out after ${config.apiTimeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || (data?.code && data.code >= 400)) {
    const error = new Error(data?.msg || `Printbelle returned HTTP ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function getProducts() {
  return request("/prod_api/api/products/v2/all", { method: "GET" });
}

export async function getOrders(orderIds) {
  return request(config.listOrdersPath, {
    method: "POST",
    body: JSON.stringify({ orderIds, pageSize: Math.min(Math.max(orderIds.length, 1), 100), pageNum: 1 })
  });
}

export async function createOrder(payload) {
  return request(config.createOrderPath, { method: "POST", body: JSON.stringify(payload) });
}
