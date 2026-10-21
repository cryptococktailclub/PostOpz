// Vagon Teams adapter for PostOpz Virtual Edit Studio.
// Only read-only GET methods are exposed to callers. Writes are intentionally NOT implemented.
// Reference: https://docs.vagon.io/teams/reference/how-to-use-teams-api
import { createHmac, randomBytes } from "node:crypto";

const API_ORIGIN = "https://api.vagon.io";
const API_PATH = "/organization-management/v1";
const MAX_RESPONSE_BYTES = 256_000;

export class VagonApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "VagonApiError";
    this.status = status;
  }
}

export function makeVagonAuthorization({ publicKey, secretKey, method, path, body = "", timestamp, nonce }) {
  if (!publicKey || !secretKey) throw new Error("Vagon credentials are not configured");
  if (!/^(GET|POST)$/.test(method) || !path.startsWith("/organization-management/v1/"))
    throw new Error("Unsupported Vagon request");
  if (!/^[a-f0-9]{16,64}$/i.test(nonce)) throw new Error("Invalid HMAC nonce");
  if (!/^\d{12,15}$/.test(String(timestamp))) throw new Error("Invalid HMAC timestamp");
  if (typeof body !== "string") throw new Error("Body must be the exact serialized request");
  // Vagon's signature includes the URL path WITH its leading slash and excludes the API origin.
  const input = publicKey + method + path + timestamp + nonce + body;
  const signature = createHmac("sha256", secretKey).update(input, "utf8").digest("hex");
  return "HMAC " + publicKey + ":" + signature + ":" + nonce + ":" + timestamp;
}

export function createVagonClient({ publicKey, secretKey, fetchImpl = fetch, now = () => Date.now(),
  nonce = () => randomBytes(16).toString("hex"), timeoutMs = 12_000 } = {}) {
  if (!publicKey || !secretKey) throw new Error("Vagon Teams API credentials not configured");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000)
    throw new Error("Invalid timeout");
  async function read(path) {
    // Exact allowlist prevents both unexpected provider writes and arbitrary network calls.
    if (!["/organization-management/v1/machines", "/organization-management/v1/software"].includes(path))
      throw new Error("Unapproved Vagon read endpoint");
    const authorization = makeVagonAuthorization({
      publicKey, secretKey, method:"GET", path, body:"",
      timestamp:String(now()), nonce:nonce()
    });
    let response;
    try {
      response = await fetchImpl(API_ORIGIN + path, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error"
      });
    } catch {
      throw new VagonApiError("Vagon API connection failed");
    }
    if (!response.ok) throw new VagonApiError("Vagon API rejected read request", response.status);
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType && !contentType.includes("json"))
      throw new VagonApiError("Vagon API returned unexpected content");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new VagonApiError("Vagon API response exceeds safe size");
    try { return JSON.parse(body); } catch { throw new VagonApiError("Vagon API returned invalid JSON"); }
  }
  return Object.freeze({
    listMachines: () => read(API_PATH + "/machines"),
    listSoftware: () => read(API_PATH + "/software")
  });
}

export function getVagonConnectionConfig(getEnv) {
  const publicKey = String(getEnv("VAGON_TEAMS_API_PUBLIC_KEY") || "").trim();
  const secretKey = String(getEnv("VAGON_TEAMS_API_SECRET_KEY") || "").trim();
  return { configured: Boolean(publicKey && secretKey), publicKey, secretKey };
}

// Produces a NONEXECUTABLE draft for manual operator review.
// The actual POST /machines spends from the Vagon organization's balance.
// This module contains no public create/start/stop/access capability.
export function draftVagonMachine({
  planId, region, softwareIds = [], baseImageId = null, os = "windows"
}) {
  if (!Number.isSafeInteger(planId) || planId <= 0) throw new Error("Vagon plan ID must be approved");
  if (typeof region !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(region))
    throw new Error("Vagon region must be verified with the vendor");
  if (os !== "windows") throw new Error("Premiere pilot is Windows-only pending compatibility tests");
  if (!Array.isArray(softwareIds) || softwareIds.length > 20 || !softwareIds.every(
    x => Number.isSafeInteger(x) && x > 0
  )) throw new Error("Invalid preinstall application IDs");
  if (baseImageId !== null && (!Number.isSafeInteger(baseImageId) || baseImageId <= 0))
    throw new Error("Invalid base image ID");
  return Object.freeze({
    endpoint: "POST /organization-management/v1/machines",
    executionEnabled: false,
    vendorPaymentRequired: true,
    requires: [
      "approved-price", "customer-contract", "approved-max-spend",
      "verified-account-plan", "tenant-isolation", "software-license",
      "approved-region", "media-readiness", "operator-authorization"
    ],
    request: {
      plan_id: planId, quantity: 1, region, os,
      software_ids: [...new Set(softwareIds)],
      base_image_id: baseImageId,
      permissions: {
        public_internet_access: true,          // media services require controlled internet connectivity
        can_download_from_vagon_workstation: false,
        can_upload_to_workstation: false,
        analytics_collection_enabled: false,
        clipboard_enabled: false,
        screen_recording_enabled: false,
        input_recording_enabled: false
      }
    }
  });
}
