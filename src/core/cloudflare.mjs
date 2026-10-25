import crypto from "crypto";

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
];

const CF_BYPASS_COOKIES = ["__cf_bm", "cf_clearance", "_cfuvid"];

function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

export function extractCookies(res) {
  const cookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    for (const c of res.headers.getSetCookie()) {
      const eq = c.indexOf("=");
      if (eq > 0) {
        const name = c.substring(0, eq).trim();
        if (name && !["Path", "Domain", "Expires", "Max-Age", "SameSite", "HttpOnly", "Secure", ""].includes(name))
          cookies.push(c.split(";")[0]);
      }
    }
  } else {
    const setCookie = res.headers.get("set-cookie") || "";
    let current = "";
    for (let i = 0; i < setCookie.length; i++) {
      if (setCookie[i] === "," && !setCookie.substring(i + 1).match(/^\s*\d{2} /)) {
        current = current.trim();
        if (current) cookies.push(current.split(";")[0]);
        current = "";
      } else {
        current += setCookie[i];
      }
    }
    if (current.trim()) {
      const p = current.split(";")[0];
      const eq = p.indexOf("=");
      if (eq > 0) {
        const name = p.substring(0, eq).trim();
        if (name && !["Path", "Domain", "Expires", "Max-Age", "SameSite", "HttpOnly", "Secure", ""].includes(name))
          cookies.push(p);
      }
    }
  }
  return cookies;
}

function mergeCookies(jar, newCookies) {
  if (!newCookies || newCookies.length === 0) return jar;
  const map = new Map();
  if (jar) {
    for (const c of jar.split("; ")) {
      const eq = c.indexOf("=");
      if (eq > 0) map.set(c.substring(0, eq).trim(), c);
    }
  }
  for (const c of newCookies) {
    const eq = c.indexOf("=");
    if (eq > 0) map.set(c.substring(0, eq).trim(), c);
  }
  return [...map.values()].join("; ");
}

export class CFBypass {
  constructor(opts = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelay = opts.baseDelay ?? 1000;
    this.maxDelay = opts.maxDelay ?? 16000;
    this.cookieJar = opts.cookies || "";
    this.userAgent = opts.userAgent || randomUA();
    this.proxyUrl = opts.proxyUrl || process.env.PROXY_URL || null;
    this.fetchTimeout = opts.fetchTimeout ?? 30000;
    this._consecutiveBlocks = 0;
  }

  getCookies() {
    return this.cookieJar;
  }

  setCookies(cookies) {
    this.cookieJar = cookies;
  }

  clearCFCookies() {
    const cookies = this.cookieJar ? this.cookieJar.split("; ") : [];
    const filtered = cookies.filter(c => {
      const name = c.split("=")[0];
      return !CF_BYPASS_COOKIES.includes(name);
    });
    this.cookieJar = filtered.join("; ");
  }

  _buildHeaders(headers = {}) {
    return {
      "user-agent": this.userAgent,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": `"Chromium";v="140", "Google Chrome";v="140", "Not?A_Brand";v="99"`,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": `"Windows"`,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...headers,
    };
  }

  _isRetryable(status, text) {
    if (status === 429) return true;
    if (status === 403) {
      if (text.includes("cf_chl_opt") || text.includes("challenge-platform") || text.includes("Just a moment") || text.includes("Cloudflare"))
        return true;
    }
    if (status === 503 && (text.includes("cloudflare") || text.includes("cf-error"))) return true;
    return false;
  }

  async fetch(url, opts = {}) {
    const maxAttempts = opts.retries ?? this.maxRetries;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const headers = this._buildHeaders(opts.headers);
      if (this.cookieJar) headers["cookie"] = this.cookieJar;

      const fetchOpts = {
        method: opts.method || "GET",
        headers,
        redirect: opts.redirect || "follow",
        ...(opts.body ? { body: opts.body } : {}),
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout ?? this.fetchTimeout);
      fetchOpts.signal = controller.signal;

      if (this.proxyUrl) {
        try {
          const { ProxyAgent } = await import("undici");
          fetchOpts.dispatcher = new ProxyAgent(this.proxyUrl);
        } catch {
          // proxy not available
        }
      }

      let res;
      try {
        res = await fetch(url, fetchOpts);
      } finally {
        clearTimeout(timeoutId);
      }
      const newCookies = extractCookies(res);
      if (newCookies.length > 0) this.cookieJar = mergeCookies(this.cookieJar, newCookies);

      const text = await res.text();

      if (res.ok) return { status: res.status, headers: res.headers, data: text };

      if (this._isRetryable(res.status, text) && attempt < maxAttempts) {
        const delay = Math.min(this.baseDelay * Math.pow(2, attempt) + Math.random() * 500, this.maxDelay);
        this._consecutiveBlocks++;
        await new Promise(r => setTimeout(r, delay));
        this.userAgent = randomUA();
        this.clearCFCookies();
        continue;
      }

      return { status: res.status, headers: res.headers, data: text, error: true };
    }

    return { status: 403, headers: null, data: "Max retries exceeded", error: true };
  }

  async fetchJSON(url, opts = {}) {
    const result = await this.fetch(url, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
    });
    if (result.data) {
      try { result.json = JSON.parse(result.data); } catch {}
    }
    return result;
  }

  async fetchStream(url, opts = {}) {
    const headers = this._buildHeaders(opts.headers);
    if (this.cookieJar) headers["cookie"] = this.cookieJar;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout ?? this.fetchTimeout);
    const fetchOpts = {
      method: opts.method || "GET",
      headers,
      redirect: opts.redirect || "follow",
      signal: controller.signal,
      ...(opts.body ? { body: opts.body } : {}),
    };

    if (this.proxyUrl) {
      try {
        const { ProxyAgent } = await import("undici");
        fetchOpts.dispatcher = new ProxyAgent(this.proxyUrl);
      } catch {}
    }

    try {
      return await fetch(url, fetchOpts);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
