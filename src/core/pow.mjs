// FNV-1a 32-bit hash with finalization (FNV-1a + bit mixing)
// Used by both ChatGPT Web and ChatGPT Mobile backends for Proof-of-Work

import crypto from "crypto";

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export function fnv1a(str) {
  let hash = 0x811C9DC5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
    hash >>>= 0; // force unsigned 32-bit
  }
  // Finalization mix
  hash ^= (hash >>> 16);
  hash = Math.imul(hash, 0x85EBCA6B); // 2246822507
  hash >>>= 0;
  hash ^= (hash >>> 13);
  hash = Math.imul(hash, 0xC2B2AE35); // 3266489909
  hash >>>= 0;
  hash ^= (hash >>> 16);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildConfig(overrides = {}) {
  const now = new Date();
  return [
    4880,
    now.toDateString(),
    4294705152,
    overrides.nonce ?? Math.floor(Math.random() * 100000),
    overrides.userAgent || DEFAULT_UA,
    null,
    overrides.buildId || "",
    "en-US",
    "en-US,en",
    Math.random(),
    "webkitGetUserMedia",
    "location",
    "window",
    800 + Math.random() * 600,
    overrides.deviceId || crypto.randomUUID(),
    "",
    20,
    Date.now(),
  ];
}

export function encodeConfig(config) {
  const json = JSON.stringify(config);
  return "gAAAAAC" + Buffer.from(json).toString("base64");
}

export function generateToken(config) {
  return encodeConfig(config);
}

function runCheck(t0, seed, difficulty, nonce, config) {
  config[3] = nonce;
  config[9] = Math.round(Date.now() - t0);
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64");
  const hash = fnv1a(seed + encoded);
  if (hash.slice(0, difficulty.length) <= difficulty) {
    return encoded + "~S";
  }
  return null;
}

export function solvePow(seed, difficulty, config, maxAttempts = 500000) {
  if (!difficulty || difficulty.length === 0) throw new Error("Invalid empty difficulty");
  const t0 = Date.now();
  for (let i = 0; i < maxAttempts; i++) {
    const result = runCheck(t0, seed, difficulty, i, config);
    if (result) {
      return "gAAAAAB" + result;
    }
  }
  return null;
}
