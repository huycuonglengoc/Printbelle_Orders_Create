import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

let client;

function getClient() {
  if (!config.r2.enabled) return null;
  client ||= new S3Client({
    region: "auto",
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey
    }
  });
  return client;
}

function publicUrlFor(key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${config.r2.publicBaseUrl}/${encodedKey}`;
}

export function isDirectPublicArtworkUrl(value) {
  try {
    const artworkUrl = new URL(value);
    const publicBase = new URL(config.r2.publicBaseUrl);
    const basePath = publicBase.pathname.replace(/\/$/, "");
    return artworkUrl.protocol === "https:"
      && artworkUrl.origin === publicBase.origin
      && artworkUrl.pathname.startsWith(`${basePath}/`)
      && !artworkUrl.search
      && !artworkUrl.hash;
  } catch {
    return false;
  }
}

export function r2Status() {
  return {
    enabled: config.r2.enabled,
    requiredForImport: config.r2.requiredForImport,
    publicBaseUrl: config.r2.publicBaseUrl,
    publicBaseUrlError: config.r2.publicBaseUrlError,
    directPublicUrl: config.r2.enabled
  };
}

export async function uploadArtworkToR2({ key, buffer, contentType }) {
  const storageClient = getClient();
  if (!storageClient) throw new Error(`Cloudflare R2 direct public storage is not configured. ${config.r2.publicBaseUrlError || "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL."}`);
  await storageClient.send(new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
    CacheControl: "public, max-age=31536000, immutable"
  }));
  return publicUrlFor(key);
}
