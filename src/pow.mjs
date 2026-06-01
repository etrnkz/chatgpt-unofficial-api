// FNV-1a 32-bit hash with finalization (FNV-1a + bit mixing)
// Based on realasfngl/ChatGPT challenges.py

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
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateToken(config) {
  const json = JSON.stringify(config);
  const b64 = Buffer.from(json).toString('base64');
  return 'gAAAAAC' + b64;
}

function runCheck(t0, seed, difficulty, nonce, config) {
  config[3] = nonce;
  config[9] = Math.round(Date.now() - t0);
  const encoded = b64EncodeJson(config);
  const hash = fnv1a(seed + encoded);
  if (hash.slice(0, difficulty.length) <= difficulty) {
    return encoded + '~S';
  }
  return null;
}

function b64EncodeJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

export function solvePow(seed, difficulty, config, maxAttempts = 500000) {
  if (!difficulty || difficulty.length === 0) throw new Error("Invalid empty difficulty");
  const t0 = Date.now();
  for (let i = 0; i < maxAttempts; i++) {
    const result = runCheck(t0, seed, difficulty, i, config);
    if (result) {
      return 'gAAAAAB' + result;
    }
  }
  return null;
}
