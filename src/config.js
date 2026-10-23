import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const configPath = path.resolve(process.env.CATALOG_CONFIG_PATH || path.join(rootDir, "data/catalog.json"));

const r2AccountId = process.env.R2_ACCOUNT_ID || "";
const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
function publicBaseUrlError(value) {
  if (!value) return "R2_PUBLIC_BASE_URL is missing.";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "R2_PUBLIC_BASE_URL must use HTTPS.";
    if (url.username || url.password || url.search || url.hash) return "R2_PUBLIC_BASE_URL must not contain credentials, query parameters, or a fragment.";
    if (url.hostname.endsWith(".r2.cloudflarestorage.com")) return "R2_PUBLIC_BASE_URL must be a public r2.dev URL or custom domain, not the private S3 endpoint.";
    return "";
  } catch {
    return "R2_PUBLIC_BASE_URL is not a valid URL.";
  }
}
const r2PublicBaseUrlError = publicBaseUrlError(r2PublicBaseUrl);
const r2CredentialsConfigured = Boolean(
  r2AccountId && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET
);

export function normalizeCatalog(catalog) {
  return {
    spus: Array.isArray(catalog?.spus) ? catalog.spus : [],
    sizeMappings: catalog?.sizeMappings && typeof catalog.sizeMappings === "object" ? catalog.sizeMappings : {},
    colorMappings: catalog?.colorMappings && typeof catalog.colorMappings === "object" ? catalog.colorMappings : {},
    variantMappings: catalog?.variantMappings && typeof catalog.variantMappings === "object" ? catalog.variantMappings : {},
    variantRules: Array.isArray(catalog?.variantRules) ? catalog.variantRules : [],
    defaultSizeRules: Array.isArray(catalog?.defaultSizeRules) ? catalog.defaultSizeRules : []
  };
}

function loadCatalogConfig() {
  try {
    return normalizeCatalog(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch (error) {
    console.warn(`Could not read catalog config at ${configPath}: ${error.message}`);
    return normalizeCatalog({});
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  apiBaseUrl: (process.env.PRINTBELLE_API_BASE_URL || "https://fulfillment.printbelle.com").replace(/\/$/, ""),
  apiToken: process.env.PRINTBELLE_API_TOKEN || "",
  createOrderPath: process.env.PRINTBELLE_CREATE_ORDER_PATH || "/prod_api/api/orders/v2/create",
  listOrdersPath: process.env.PRINTBELLE_LIST_ORDERS_PATH || "/prod_api/api/orders/v2/all",
  apiTimeoutMs: Number(process.env.PRINTBELLE_API_TIMEOUT_MS || 30000),
  dryRun: String(process.env.PRINTBELLE_DRY_RUN || "true").toLowerCase() !== "false",
  artworkBaseUrl: (process.env.ARTWORK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "var/uploads")),
  importTemplatePath: path.resolve(process.env.ORDER_IMPORT_TEMPLATE_PATH || path.join(rootDir, "order_import_template.xlsx")),
  r2: {
    accountId: r2AccountId,
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    endpoint: process.env.R2_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : ""),
    publicBaseUrl: r2PublicBaseUrl,
    enabled: r2CredentialsConfigured && !r2PublicBaseUrlError,
    publicBaseUrlError: r2PublicBaseUrlError,
    requiredForImport: String(process.env.R2_REQUIRED || "true").toLowerCase() !== "false"
  },
  catalogPath: configPath,
  catalog: loadCatalogConfig()
};

export function publicConfig() {
  return {
    dryRun: config.dryRun,
    apiBaseUrl: config.apiBaseUrl,
    createOrderPath: config.createOrderPath,
    artworkBaseUrl: config.artworkBaseUrl,
    r2: {
      enabled: config.r2.enabled,
      requiredForImport: config.r2.requiredForImport,
      publicBaseUrl: config.r2.publicBaseUrl,
      publicBaseUrlError: config.r2.publicBaseUrlError
    },
    hasApiToken: Boolean(config.apiToken),
    catalog: config.catalog
  };
}
