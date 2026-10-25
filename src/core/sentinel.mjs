import crypto from "crypto";
import { fnv1a, buildConfig, encodeConfig } from "./pow.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const BASE = "https://chatgpt.com";

export { buildConfig, encodeConfig };

export async function getSentinelToken(tokenType, accessToken, buildId, deviceId) {
  tokenType = tokenType || "password_verify";

  const config = buildConfig({ buildId, deviceId });
  const pValue = encodeConfig(config);

  try {
    const res = await fetch(BASE + "/backend-api/sentinel/req", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        "oai-device-id": deviceId || config[14],
        "oai-client-version": buildId || "",
      },
      body: JSON.stringify({ p: pValue }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.token || data.sentinel_token || null;
    }

    // Fallback: try anonymous sentinel endpoint with access token
    const res2 = await fetch(BASE + "/backend-anon/sentinel/chat-requirements", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ p: pValue }),
    });

    if (res2.ok) {
      const data2 = await res2.json();
      return data2.token || null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getSentinelTokenFromPrepare(accessToken, buildId, deviceId) {
  // Two-step prepare/finalize flow (used for anonymous sentinel challenges)
  const config = buildConfig({ buildId, deviceId });
  const pValue = encodeConfig(config);

  try {
    // Step 1: prepare
    const r1 = await fetch(BASE + "/backend-anon/sentinel/chat-requirements/prepare", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (!r1.ok) return null;
    const d1 = await r1.json();
    const prepareToken = d1.prepare_token;
    if (!prepareToken) return null;

    // Step 2: finalize
    const r2 = await fetch(BASE + "/backend-anon/sentinel/chat-requirements/finalize", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        "openai-sentinel-chat-requirements-token": prepareToken,
        "x-openai-target-path": "/backend-api/sentinel/chat-requirements/finalize",
        "x-openai-target-route": "/backend-api/sentinel/chat-requirements/finalize",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (!r2.ok) return null;
    const d2 = await r2.json();
    return d2.token || null;
  } catch {
    return null;
  }
}

// Proof-of-work solver for sentinel challenges (same as pow.mjs but returns the token string)
export function solveSentinelProof(seed, difficulty, config) {
  const startTime = Date.now();
  const maxAttempts = 500000;
  const configCopy = [...config];

  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    configCopy[3] = nonce;
    configCopy[9] = Date.now() - startTime;
    const encoded = Buffer.from(JSON.stringify(configCopy)).toString("base64");
    const hash = fnv1a(seed + "gAAAAAB" + encoded);
    const prefix = hash.substring(0, difficulty.length);
    if (prefix <= difficulty) {
      return "gAAAAAB" + encoded;
    }
  }

  return "gAAAAAB" + Buffer.from(JSON.stringify(config)).toString("base64");
}
