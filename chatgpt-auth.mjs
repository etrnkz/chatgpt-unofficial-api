import { UploadManager, buildMultimodalMessage } from "./src/upload.mjs";
import { solvePow } from "./src/pow.mjs";
import { TurnstileVM } from "./src/turnstile.mjs";
import crypto from "crypto";
import { CFBypass } from "./src/cloudflare.mjs";
import { getSentinelToken } from "./src/sentinel.mjs";
import { parseSSEBuffer, streamSSEResponse } from "./sse.mjs";
import { createTempEmail, waitForOTP } from "./tempmail.mjs";

const BASE = "https://chatgpt.com";
const AUTH_BASE = "https://auth.openai.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function extractCookies(res) {
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
  return cookies.join("; ");
}

export class ChatGPTAuth {
  constructor(opts = {}) {
    this.accessToken = opts.accessToken || null;
    this.sessionToken = opts.sessionToken || null;
    this.csrfToken = null;
    this.deviceId = null;
    this.buildId = null;
    this.conversationId = null;
    this.parentMessageId = null;
    this.timezoneOffset = -new Date().getTimezoneOffset();
    this.uploadManager = null;
    this._authCookieJar = "";
    this.sentinelToken = null;
    this.proofOfWork = null;
    this.bytecode = null;
    this.vmToken = null;
    this.conduitToken = null;
    this.config = null;
    this._cookies = opts.cookies || null;
    this._cf = new CFBypass({
      maxRetries: opts.maxRetries ?? 3,
      proxyUrl: opts.proxyUrl,
      cookies: opts.cookies || undefined,
    });
  }

  async init() {
    // Parse browser cookies if provided
    if (this._cookies && !this.accessToken) {
      this._parseCookies(this._cookies);
    }

    const res = await this._cf.fetch(BASE + "/", { headers: { accept: "text/html" }, retries: 1 });
    const html = res.data;
    this.buildId = (html.match(/data-build="([^"]+)"/) || [])[1];
    if (!this.buildId) this._cf.userAgent = UA;
    const didMatch = html.match(/oai-did=([^;]+)/);
    this.deviceId = (didMatch && didMatch[1]) || crypto.randomUUID();

    if (this.sessionToken && !this.accessToken) {
      await this.loginWithSession();
    }
    if (!this.accessToken && !this.sessionToken) {
      throw new Error("Provide accessToken, sessionToken, or cookies");
    }
  }

  _parseCookies(cookieStr) {
    this._cf.setCookies(cookieStr);
    const cookies = {};
    for (const part of cookieStr.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) {
        const name = part.substring(0, eq).trim();
        const value = part.substring(eq + 1).trim();
        cookies[name] = value;
      }
    }
    const chunk0 = cookies["__Secure-next-auth.session-token.0"];
    const chunk1 = cookies["__Secure-next-auth.session-token.1"];
    const single = cookies["__Secure-next-auth.session-token"];
    if (single) {
      this.sessionToken = single;
    } else if (chunk0) {
      this.sessionToken = chunk0 + (chunk1 || "");
    }
  }

  async loginWithSession() {
    const res = await fetch(BASE + "/api/auth/session", {
      headers: {
        "user-agent": UA,
        cookie: `__Secure-next-auth.session-token=${this.sessionToken}`,
      },
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error("Session login failed: no accessToken in response");
    this.accessToken = data.accessToken;
  }

  _buildConfig() {
    const now = new Date();
    return [
      4880,
      now.toDateString(),
      4294705152,
      Math.random(),
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      null,
      this.buildId || "",
      "en-US",
      "en-US,en",
      Math.random(),
      "webkitGetUserMedia",
      "location",
      "window",
      800 + Math.random() * 600,
      crypto.randomUUID(),
      "",
      20,
      Date.now(),
    ];
  }

  async getChatRequirements() {
    this.config = this._buildConfig();
    const pValue = "gAAAAAC" + Buffer.from(JSON.stringify(this.config)).toString("base64");
    this.vmToken = pValue;

    const res = await this._cf.fetch(BASE + "/backend-api/sentinel/chat-requirements", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ p: pValue }),
    });

    if (res.error) {
      // Fallback: try through backend-anon proxy
      const res2 = await this._cf.fetch(BASE + "/backend-anon/sentinel/chat-requirements", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openai-target-path": "/backend-api/sentinel/chat-requirements",
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify({ p: pValue }),
      });
      if (res2.error) throw new Error("Failed to get chat requirements");
      const data = JSON.parse(res2.data);
      this.sentinelToken = data.token;
      this.proofOfWork = data.proofofwork;
      this.bytecode = data.turnstile?.dx || null;
      return;
    }

    const data = JSON.parse(res.data);
    this.sentinelToken = data.token;
    this.proofOfWork = data.proofofwork;
    this.bytecode = data.turnstile?.dx || null;
  }

  async getConduit(next = false) {
    const body = {
      action: "next",
      fork_from_shared_post: false,
      parent_message_id: this.parentMessageId || "client-created-root",
      model: "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
    };
    if (next && this.conversationId) {
      body.conversation_id = this.conversationId;
      body.parent_message_id = this.parentMessageId;
    }

    const res = await this._cf.fetch(BASE + "/backend-anon/f/conversation/prepare", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openai-target-path": "/backend-api/f/conversation/prepare",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = JSON.parse(res.data);
    if (data.status === "ok" && data.conduit_token) {
      this.conduitToken = data.conduit_token;
      return data.conduit_token;
    }
    throw new Error("Conduit failed: " + (res.data || JSON.stringify(data)));
  }

  async login(email, password, sentinelToken, getOTPCode) {
    // Step 1: Get CSRF
    const r1 = await fetch(BASE + "/api/auth/csrf", { headers: { "user-agent": UA } });
    const { csrfToken } = await r1.json();
    const csrfCookieRaw = decodeURIComponent(
      (r1.headers.get("set-cookie") || "").match(/__Host-next-auth.csrf-token=([^;]+)/)?.[1] || ""
    );

    // Step 2: Get OAuth authorize URL
    const r2 = await fetch(BASE + "/api/auth/signin/openai", {
      method: "POST", redirect: "manual",
      headers: {
        "user-agent": UA, "content-type": "application/x-www-form-urlencoded",
        "cookie": `__Host-next-auth.csrf-token=${csrfCookieRaw}`,
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: BASE + "/", json: "true" })
    });
    const { url: authorizeUrl } = await r2.json();

    // Step 3: Follow redirect chain to establish auth session
    let jar = "";
    let url = authorizeUrl;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, {
        headers: { "user-agent": UA, ...(jar ? { cookie: jar } : {}) },
        redirect: "manual"
      });
      const nc = extractCookies(res);
      if (nc) jar = jar ? [jar, nc].join("; ") : nc;
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) break;
      url = loc.startsWith("http") ? loc : new URL(loc, url).href;
    }
    this._authCookieJar = jar;

    // Step 4: Submit email
    const r4 = await fetch(AUTH_BASE + "/api/accounts/authorize/continue", {
      method: "POST",
      headers: {
        "user-agent": UA, "content-type": "application/json",
        "cookie": jar, "origin": "https://auth.openai.com",
        "referer": "https://auth.openai.com/log-in", "accept": "application/json",
      },
      body: JSON.stringify({ username: { kind: "email", value: email } })
    });
    const nc4 = extractCookies(r4);
    if (nc4) jar = jar ? [jar, nc4].join("; ") : nc4;
    const emailData = await r4.json();
    this._authCookieJar = jar;

    if (emailData.page?.type === "email_otp_verification") {
      // OTP verification required
      const sessId = emailData["oai-client-auth-session"]?.session_id;
      const otpCode = typeof getOTPCode === "function"
        ? await getOTPCode(email, sessId)
        : await this._promptOTP(email, sessId);
      if (!otpCode) throw new Error("OTP code required but none provided");
      return await this._verifyOTPAndLogin(otpCode, emailData, jar);
    }

    if (emailData.page?.type !== "login_password") {
      throw new Error(`Unexpected page type after email: ${emailData.page?.type}. Only password-based login and OTP verification are supported.`);
    }

    // Step 5: Submit password with optional sentinel token
    let sentinel = sentinelToken;
    if (!sentinel) {
      try {
        sentinel = await getSentinelToken("password_verify", this.accessToken, this.buildId, this.deviceId);
      } catch {}
    }

    const hdrs = {
      "user-agent": UA, "content-type": "application/json",
      "cookie": jar, "origin": "https://auth.openai.com",
      "referer": "https://auth.openai.com/log-in/password",
      "accept": "application/json",
    };
    if (sentinel) hdrs["OpenAI-Sentinel-Token"] = sentinel;

    const r5 = await fetch(AUTH_BASE + "/api/accounts/password/verify", {
      method: "POST", redirect: "manual",
      headers: hdrs,
      body: JSON.stringify({ password })
    });
    const nc5 = extractCookies(r5);
    if (nc5) jar = jar ? [jar, nc5].join("; ") : nc5;
    this._authCookieJar = jar;

    const pwStatus = r5.status;
    const pwLocation = r5.headers.get("location");

    if (pwStatus < 300 || pwStatus >= 400 || !pwLocation) {
      const errBody = await r5.text();
      throw new Error(`Password verify failed (${pwStatus}): ${errBody.substring(0, 500)}`);
    }

    // Step 6: Follow redirect chain through NextAuth callback
    url = pwLocation;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(url, {
        headers: { "user-agent": UA, ...(jar ? { cookie: jar } : {}) },
        redirect: "manual"
      });
      const nc = extractCookies(res);
      if (nc) jar = jar ? [jar, nc].join("; ") : nc;
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) {
        // Check if we landed on a page that has the session cookie
        const sessRes = await fetch(BASE + "/api/auth/session", {
          headers: { "user-agent": UA, cookie: jar }
        });
        const sessData = await sessRes.json();
        if (sessData.accessToken) {
          this.accessToken = sessData.accessToken;
          this.csrfToken = sessData.csrfToken || null;
          return sessData;
        }
        throw new Error(`Login failed: no access token obtained. Status ${res.status}`);
      }
      url = loc.startsWith("http") ? loc : new URL(loc, url).href;
    }
    throw new Error("Login failed: too many redirects");
  }

  async _promptOTP(email, sessionId) {
    // Interactive OTP prompt via stdin
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
      rl.question(`OTP code sent to ${email}. Enter code (or empty to abort): `, code => {
        rl.close();
        resolve(code.trim() || null);
      });
    });
  }

  async _verifyOTPAndLogin(otpCode, emailData, jar) {
    // Visit continue_url to establish session
    const pageRes = await fetch(emailData.continue_url, {
      headers: { "user-agent": UA, cookie: jar, accept: "text/html" },
      redirect: "manual",
    });
    const nc = extractCookies(pageRes);
    if (nc) jar = jar ? [jar, nc].join("; ") : nc;
    this._authCookieJar = jar;

    // Submit OTP code for validation
    const validateRes = await fetch(AUTH_BASE + "/api/accounts/email-otp/validate", {
      method: "POST",
      headers: {
        "user-agent": UA, "content-type": "application/json",
        "cookie": jar, "origin": "https://auth.openai.com",
        "accept": "application/json",
      },
      body: JSON.stringify({ code: otpCode }),
    });

    if (!validateRes.ok) {
      const errData = validateRes.status === 401
        ? "Incorrect code"
        : validateRes.status === 429
        ? "Too many attempts. Try again later."
        : await validateRes.text().then(t => t.substring(0, 200));
      throw new Error(`OTP validation failed (${validateRes.status}): ${errData}`);
    }

    const validateData = await validateRes.json();
    const nc2 = extractCookies(validateRes);
    if (nc2) jar = jar ? [jar, nc2].join("; ") : nc2;
    this._authCookieJar = jar;

    // The validate response may be a redirect or indicate next step
    const redirectUrl = validateRes.headers.get("location") || validateData.redirect_url;
    if (redirectUrl) {
      return await this._followAuthRedirects(redirectUrl, jar);
    }

    // Check session directly
    const sessRes = await fetch(BASE + "/api/auth/session", {
      headers: { "user-agent": UA, cookie: jar }
    });
    const sessData = await sessRes.json();
    if (sessData.accessToken) {
      this.accessToken = sessData.accessToken;
      this.csrfToken = sessData.csrfToken || null;
      return sessData;
    }

    throw new Error("OTP verification succeeded but no access token obtained");
  }

  async _followAuthRedirects(startUrl, jar) {
    let url = startUrl;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(url, {
        headers: { "user-agent": UA, ...(jar ? { cookie: jar } : {}) },
        redirect: "manual"
      });
      const nc = extractCookies(res);
      if (nc) jar = jar ? [jar, nc].join("; ") : nc;
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) {
        const sessRes = await fetch(BASE + "/api/auth/session", {
          headers: { "user-agent": UA, cookie: jar }
        });
        const sessData = await sessRes.json();
        if (sessData.accessToken) {
          this.accessToken = sessData.accessToken;
          this.csrfToken = sessData.csrfToken || null;
          return sessData;
        }
        throw new Error(`Auth redirect chain failed. Status ${res.status}`);
      }
      url = loc.startsWith("http") ? loc : new URL(loc, url).href;
    }
    throw new Error("Auth redirect chain: too many redirects");
  }

  async signup(email, options = {}) {
    // options: { password, name, birthday, getOTPCode }
    const password = options.password || "";
    const getOTPCode = options.getOTPCode;
    const name = options.name || "";
    const birthday = options.birthday || "";

    // Step 1: Get CSRF
    const r1 = await fetch(BASE + "/api/auth/csrf", { headers: { "user-agent": UA } });
    const { csrfToken } = await r1.json();
    const csrfCookieRaw = decodeURIComponent(
      (r1.headers.get("set-cookie") || "").match(/__Host-next-auth.csrf-token=([^;]+)/)?.[1] || ""
    );

    // Step 2: Get OAuth authorize URL
    const r2 = await fetch(BASE + "/api/auth/signin/openai", {
      method: "POST", redirect: "manual",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded",
        cookie: `__Host-next-auth.csrf-token=${csrfCookieRaw}`,
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: BASE + "/", json: "true" })
    });
    const { url: authorizeUrl } = await r2.json();

    // Step 3: Follow redirect chain to establish auth session
    let jar = "";
    let url = authorizeUrl;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, {
        headers: { "user-agent": UA, ...(jar ? { cookie: jar } : {}) },
        redirect: "manual"
      });
      const nc = extractCookies(res);
      if (nc) jar = jar ? [jar, nc].join("; ") : nc;
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) break;
      url = loc.startsWith("http") ? loc : new URL(loc, url).href;
    }
    this._authCookieJar = jar;

    // Step 4: Submit email with signup intent
    const r4 = await fetch(AUTH_BASE + "/api/accounts/authorize/continue", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json",
        cookie: jar, origin: "https://auth.openai.com",
        referer: "https://auth.openai.com/log-in", accept: "application/json",
      },
      body: JSON.stringify({ username: { kind: "email", value: email }, screen_hint: "signup" })
    });
    const nc4 = extractCookies(r4);
    if (nc4) jar = jar ? [jar, nc4].join("; ") : nc4;
    const emailData = await r4.json();
    this._authCookieJar = jar;

    if (emailData.page?.type === "email_otp_verification") {
      // OTP required for signup
      if (emailData.page?.payload?.email_verification_mode !== "passwordless_signup") {
        throw new Error(`Unexpected verification mode: ${emailData.page?.payload?.email_verification_mode}`);
      }

      // Get OTP code from user or callback
      const otpCode = typeof getOTPCode === "function"
        ? await getOTPCode(email, emailData["oai-client-auth-session"]?.session_id)
        : await this._promptOTP(email, emailData["oai-client-auth-session"]?.session_id);
      if (!otpCode) throw new Error("OTP code required for signup but none provided");

      // Visit continue_url to establish session
      const pageRes = await fetch(emailData.continue_url, {
        headers: { "user-agent": UA, cookie: jar, accept: "text/html" },
        redirect: "manual",
      });
      const nc = extractCookies(pageRes);
      if (nc) jar = jar ? [jar, nc].join("; ") : nc;
      this._authCookieJar = jar;

      // Validate OTP
      const validateRes = await fetch(AUTH_BASE + "/api/accounts/email-otp/validate", {
        method: "POST",
        headers: { "user-agent": UA, "content-type": "application/json",
          cookie: jar, origin: "https://auth.openai.com", accept: "application/json",
        },
        body: JSON.stringify({ code: otpCode }),
      });

      if (!validateRes.ok) {
        const errMsg = validateRes.status === 401 ? "Incorrect code" :
          validateRes.status === 429 ? "Too many attempts. Try again later." :
          await validateRes.text().then(t => t.substring(0, 200));
        throw new Error(`OTP validation failed (${validateRes.status}): ${errMsg}`);
      }

      const validateData = await validateRes.json();
      const ncV = extractCookies(validateRes);
      if (ncV) jar = jar ? [jar, ncV].join("; ") : ncV;
      this._authCookieJar = jar;

      // Check if redirect to follow
      const redirectUrl = validateRes.headers.get("location") || validateData.redirect_url;
      if (redirectUrl) {
        return await this._followAuthRedirects(redirectUrl, jar);
      }

      // Handle next page from OTP validation response
      if (validateData.page?.type) {
        return await this._handleSignupPage(validateData.page.type, validateData, email, password, name, birthday, jar);
      }
    }

    throw new Error(`Unexpected signup step: ${emailData.page?.type || "unknown"}`);
  }

  async autoSignup(options = {}) {
    const name = options.name || "User";
    const birthday = options.birthday || "2000-01-15";
    const generatedPassword = "ChatGPT_" + Math.random().toString(36).slice(2, 10) + "_2026!";

    console.log("Creating temp email...");
    const temp = await createTempEmail();
    console.log("Temp email:", temp.address, "(via " + temp.provider.name + ")");

    const session = await this.signup(temp.address, {
      password: generatedPassword,
      name,
      birthday,
      getOTPCode: async () => {
        console.log("Waiting for OTP email...");
        try {
          const code = await waitForOTP(temp.token, temp.provider, 90000);
          console.log("OTP code:", code);
          return code;
        } catch (err) {
          console.warn("Auto OTP failed:", err.message);
          console.warn("Check your temp inbox at https://mail.tm or enter the code manually:");
          return await this._promptOTP(temp.address);
        }
      },
    });

    return { session, tempEmail: temp.address, tempPassword: generatedPassword };
  }

  async _handleSignupPage(pageType, pageData, email, password, name, birthday, jar) {
    switch (pageType) {
      case "create_account_password":
      case "create_account":
        return await this._handleCreateAccountPassword(email, password, jar);

      case "about_you":
        return await this._handleAboutYou(name, birthday, jar);

      default:
        throw new Error(`Unhandled signup page type: ${pageType}`);
    }
  }

  async _handleCreateAccountPassword(email, password, jar) {
    if (!password) throw new Error("Password required for account creation");

    // Register user via /user/register
    const regRes = await fetch(AUTH_BASE + "/api/accounts/user/register", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json",
        cookie: jar, origin: "https://auth.openai.com", accept: "application/json",
      },
      body: JSON.stringify({ password, username: email }),
    });

    const nc = extractCookies(regRes);
    if (nc) jar = jar ? [jar, nc].join("; ") : nc;
    this._authCookieJar = jar;

    if (regRes.status === 302) {
      return await this._followAuthRedirects(regRes.headers.get("location"), jar);
    }

    if (regRes.ok) {
      const regData = await regRes.json();
      const redirectUrl = regRes.headers.get("location") || regData.redirect_url;
      if (redirectUrl) return await this._followAuthRedirects(redirectUrl, jar);

      // Check session directly
      const sessRes = await fetch(BASE + "/api/auth/session", {
        headers: { "user-agent": UA, cookie: jar }
      });
      const sessData = await sessRes.json();
      if (sessData.accessToken) {
        this.accessToken = sessData.accessToken;
        this.csrfToken = sessData.csrfToken || null;
        return sessData;
      }
    }

    const errBody = await regRes.text().catch(() => "");
    throw new Error(`Account registration failed (${regRes.status}): ${errBody.substring(0, 300)}`);
  }

  async _handleAboutYou(name, birthday, jar) {
    if (!name) throw new Error("Name required for about_you step");
    if (!birthday) throw new Error("Birthday required for about_you step (format: YYYY-MM-DD)");

    // Submit about_you data via /authorize/continue
    const body = {
      name,
      birthday: { day: parseInt(birthday.split("-")[2]), month: parseInt(birthday.split("-")[1]), year: parseInt(birthday.split("-")[0]) },
    };

    const res = await fetch(AUTH_BASE + "/api/accounts/authorize/continue", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json",
        cookie: jar, origin: "https://auth.openai.com", accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const nc = extractCookies(res);
    if (nc) jar = jar ? [jar, nc].join("; ") : nc;
    this._authCookieJar = jar;

    if (res.status === 302) {
      return await this._followAuthRedirects(res.headers.get("location"), jar);
    }

    const data = await res.json();
    const redirectUrl = res.headers.get("location") || data.redirect_url;

    if (redirectUrl) return await this._followAuthRedirects(redirectUrl, jar);

    // If there's a next page, handle it recursively
    if (data.page?.type === "add_password_new_password") {
      throw new Error("Password setting not yet implemented in about_you flow");
    }

    if (data.page?.type) {
      throw new Error(`Unhandled page after about_you: ${data.page.type}`);
    }

    // Check session
    const sessRes = await fetch(BASE + "/api/auth/session", {
      headers: { "user-agent": UA, cookie: jar }
    });
    const sessData = await sessRes.json();
    if (sessData.accessToken) {
      this.accessToken = sessData.accessToken;
      this.csrfToken = sessData.csrfToken || null;
      return sessData;
    }

    throw new Error(`About_you submission failed (${res.status}): ${JSON.stringify(data).substring(0, 200)}`);
  }

  async getCSRFToken() {
    if (this.csrfToken) return this.csrfToken;
    const res = await this._cf.fetchJSON(BASE + "/api/auth/csrf", {
      headers: {
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
    });
    if (res.json?.csrfToken) {
      this.csrfToken = res.json.csrfToken;
    }
    return this.csrfToken;
  }

  _headers(extra = {}, method = "GET") {
    const h = {
      "user-agent": this._cf.userAgent,
      "oai-device-id": this.deviceId,
      "oai-client-version": this.buildId || "",
      ...extra,
    };
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") h["content-type"] = "application/json";
    if (this.accessToken) h["authorization"] = `Bearer ${this.accessToken}`;
    if (this.csrfToken) h["oai-csrf-token"] = this.csrfToken;
    return h;
  }

  async _fetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : BASE + path;
    const headers = this._headers(opts.headers, opts.method || "GET");
    const result = await this._cf.fetch(url, { ...opts, headers, retries: opts.retries ?? 1 });
    if (result.error && result.status === 403) throw new Error("Blocked by Cloudflare");
    return {
      ok: !result.error,
      status: result.status,
      headers: result.headers,
      text: async () => result.data,
      json: async () => { try { return JSON.parse(result.data); } catch { return null; } },
    };
  }

  async _fetchJSON(path, opts = {}) {
    const res = await this._fetch(path, opts);
    return res.json();
  }

  async getModels() {
    const res = await this._fetch("/backend-api/models");
    return res.json();
  }

  async getAccount() {
    const res = await this._fetch("/backend-api/accounts/check");
    return res.json();
  }

  async getVoices() {
    const res = await this._fetch("/backend-api/settings/voices");
    return res.json();
  }

  // --- Apps (Connected Apps / Plugins / GPTs) ---

  async getApps() {
    const res = await this._fetch("/backend-api/apps");
    return res.json();
  }

  async deleteApp(appId) {
    const res = await this._fetch(`/backend-api/apps/${appId}`, { method: "DELETE" });
    return res.json();
  }

  async getGizmos() {
    const res = await this._fetch("/backend-api/gizmos");
    return res.json();
  }

  async getGizmo(gizmoId) {
    const res = await this._fetch(`/backend-api/gizmos/${gizmoId}`);
    return res.json();
  }

  // --- Personalization ---

  async getCustomInstructions() {
    const res = await this._fetch("/backend-api/settings/custom_instructions");
    return res.json();
  }

  async setCustomInstructions(instructions) {
    const body = typeof instructions === "string"
      ? { customization_options: { custom_persona: instructions } }
      : { customization_options: instructions };
    const res = await this._fetch("/backend-api/settings/custom_instructions", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async getMemory() {
    const res = await this._fetch("/backend-api/memory");
    return res.json();
  }

  async deleteMemory(memoryId) {
    const res = await this._fetch(`/backend-api/memory/${memoryId}`, { method: "DELETE" });
    return res.json();
  }

  async clearMemory() {
    const res = await this._fetch("/backend-api/memory", { method: "DELETE" });
    return res.json();
  }

  // --- Profile & Settings ---

  async getProfile() {
    const res = await this._fetch("/backend-api/me");
    return res.json();
  }

  async getSettings() {
    const res = await this._fetch("/backend-api/settings");
    return res.json();
  }

  async updateSettings(settings) {
    const res = await this._fetch("/backend-api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
    return res.json();
  }

  async toggleHistoryTraining(disabled) {
    const res = await this._fetch("/backend-api/settings/history_and_training_disabled", {
      method: "PATCH",
      body: JSON.stringify({ is_disabled: disabled }),
    });
    return res.json();
  }

  async getDataExport() {
    const res = await this._fetch("/backend-api/data_export", { method: "POST" });
    return res.json();
  }

  async getSharedLinks(offset = 0, limit = 28) {
    const res = await this._fetch(`/backend-api/shared_conversations?offset=${offset}&limit=${limit}`);
    return res.json();
  }

  async deleteSharedLink(shareId) {
    const res = await this._fetch(`/backend-api/shared_conversations/${shareId}`, { method: "DELETE" });
    return res.json();
  }

  async getNotifications() {
    const res = await this._fetch("/backend-api/notifications");
    return res.json();
  }

  async getSystemHints(mode = "basic") {
    const res = await this._fetch(`/backend-api/settings/system_hints?mode=${mode}`);
    return res.json();
  }

  async getVoiceSettings() {
    const res = await this._fetch("/backend-api/settings/voice_settings");
    return res.json();
  }

  // --- Enhanced Conversation Management ---

  async getConversations(offset = 0, limit = 28) {
    const res = await this._fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`);
    return res.json();
  }

  async getArchivedConversations(offset = 0, limit = 28) {
    const res = await this._fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated&status=archived`);
    return res.json();
  }

  async updateConversation(convId, updates) {
    const res = await this._fetch(`/backend-api/conversations/${convId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return res.json();
  }

  async archiveConversation(convId) {
    return this.updateConversation(convId, { is_archived: true });
  }

  async unarchiveConversation(convId) {
    return this.updateConversation(convId, { is_archived: false });
  }

  async starConversation(convId) {
    return this.updateConversation(convId, { is_starred: true });
  }

  async unstarConversation(convId) {
    return this.updateConversation(convId, { is_starred: false });
  }

  async setConversationTitle(convId, title) {
    return this.updateConversation(convId, { title });
  }

  async clearConversations() {
    const res = await this._fetch("/backend-api/conversations", {
      method: "PATCH",
      body: JSON.stringify({ is_visible: false }),
    });
    return res.json();
  }

  async searchConversations(query, offset = 0, limit = 28) {
    const res = await this._fetch(`/backend-api/conversations/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`);
    return res.json();
  }

  async getConversationMessages(convId) {
    const res = await this._fetch(`/backend-api/conversation/${convId}`);
    return res.json();
  }

  async forkConversation(messageId, convId = null) {
    const body = { message_id: messageId, model: "auto" };
    if (convId) body.conversation_id = convId;
    const res = await this._fetch("/backend-api/conversation/fork", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async genTitle(convId, messageId) {
    const res = await this._fetch("/backend-api/conversation/gen_title/" + convId, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId, model: "auto" }),
    });
    return res.json();
  }

  async regenerate(options = {}) {
    if (!this.parentMessageId) throw new Error("No parent message to regenerate from");
    const csrf = await this.getCSRFToken();
    const body = {
      action: "next",
      parent_message_id: this.parentMessageId,
      model: options.model || "auto",
      conversation_id: this.conversationId,
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: options.historyDisabled ?? true,
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    const res = await this._fetch("/backend-api/f/conversation", {
      method: "POST",
      headers: { "oai-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (text.includes("Unusual activity")) throw new Error("IP flagged by ChatGPT");
    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  async submitFeedback(messageId, rating, notes = "") {
    const res = await this._fetch("/backend-api/feedback", {
      method: "POST",
      body: JSON.stringify({
        message_id: messageId,
        rating: rating,
        notes: notes,
        reason: { code: 0, name: "" },
      }),
    });
    return res.json();
  }

  async reportContent(messageId, reasonCode = 1, reasonName = "other") {
    const res = await this._fetch("/backend-api/content_report", {
      method: "POST",
      body: JSON.stringify({
        message_id: messageId,
        reason: { code: reasonCode, name: reasonName },
      }),
    });
    return res.json();
  }

  // --- Projects ---

  async getProjects() {
    const res = await this._fetch("/backend-api/projects");
    return res.json();
  }

  async createProject(name, options = {}) {
    const res = await this._fetch("/backend-api/projects", {
      method: "POST",
      body: JSON.stringify({ name, ...options }),
    });
    return res.json();
  }

  async deleteProject(projectId) {
    const res = await this._fetch(`/backend-api/projects/${projectId}`, { method: "DELETE" });
    return res.json();
  }

  async updateProject(projectId, updates) {
    const res = await this._fetch(`/backend-api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return res.json();
  }

  async addConversationToProject(convId, projectId) {
    const res = await this._fetch(`/backend-api/projects/${projectId}/conversations`, {
      method: "POST",
      body: JSON.stringify({ conversation_id: convId }),
    });
    return res.json();
  }

  // --- Voice & Audio ---

  async generateSpeech(text, voice = "alloy", model = "tts-1") {
    const res = await this._fetch("/backend-api/speech", {
      method: "POST",
      body: JSON.stringify({ input: text, voice, model }),
    });
    return res.text();
  }

  async transcribeSpeech(filePath) {
    if (!this.uploadManager) this.uploadManager = new UploadManager(this);
    const info = await this.uploadManager.uploadFile(filePath);
    const res = await this._fetch("/backend-api/audio/transcriptions", {
      method: "POST",
      body: JSON.stringify({ file_id: info.fileId, model: "whisper-1" }),
    });
    return res.json();
  }

  // --- Image Generation (DALL-E) ---

  async generateImage(prompt, options = {}) {
    const csrf = await this.getCSRFToken();
    const body = {
      action: "next",
      messages: [{
        id: crypto.randomUUID(), author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [prompt] },
        metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      }],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "dall-e-3",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: options.historyDisabled ?? true,
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    if (this.conversationId) body.conversation_id = this.conversationId;
    const res = await this._fetch("/backend-api/f/conversation", {
      method: "POST",
      headers: { "oai-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (text.includes("Unusual activity")) throw new Error("IP flagged by ChatGPT");
    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  // --- Billing & Account ---

  async getBillingInfo() {
    const res = await this._fetch("/backend-api/accounts/billing");
    return res.json();
  }

  async getUsage() {
    const res = await this._fetch("/backend-api/usage");
    return res.json();
  }

  // --- Feature Flags & Drafts ---

  async getFeatureFlags() {
    const res = await this._fetch("/backend-api/features");
    return res.json();
  }

  async getDrafts() {
    const res = await this._fetch("/backend-api/drafts");
    return res.json();
  }

  // --- Search the web via ChatGPT ---

  async searchWeb(query) {
    const res = await this.ask(query, { model: "auto", forceSearch: true });
    return res;
  }

  async *streamSearchWeb(query) {
    for await (const chunk of this.streamAsk(query, { model: "auto", forceSearch: true })) {
      yield chunk;
    }
  }

  async ask(message, options = {}) {
    if (!this.accessToken) await this.init();
    if (!this.buildId) await this.init();

    const csrf = await this.getCSRFToken();

    // Get sentinel chat requirements + solve PoW + get conduit
    await this.getChatRequirements();

    // Update config for PoW
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;

    const conduitToken = await this.getConduit(!!this.conversationId);

    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(
      this.proofOfWork.seed,
      this.proofOfWork.difficulty,
      this.config
    );
    if (!proofToken) throw new Error("PoW solve failed");

    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(
        this.bytecode,
        this.vmToken,
        "[]"
      );
    }

    // Upload files if provided
    let fileUploads = [];
    if (options.files && options.files.length > 0) {
      if (!this.uploadManager) this.uploadManager = new UploadManager(this);
      for (const fp of options.files) {
        const info = await this.uploadManager.uploadFile(fp);
        fileUploads.push(info);
      }
    }

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    // Build message content
    let convMessage;
    if (fileUploads.length > 0) {
      const { parts, attachments } = buildMultimodalMessage(message, fileUploads);
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "multimodal_text", parts },
        metadata: { attachments, selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    } else {
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [message] },
        metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    }

    const body = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: options.historyDisabled ?? true,
      conversation_mode: options.forceSearch
        ? { kind: "primary_assistant", tools: [{ type: "search" }] }
        : { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: options.systemHints || [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: true, time_since_loaded: 3,
        page_height: 1219, page_width: 3440, pixel_ratio: 1,
        screen_height: 1440, screen_width: 3440,
      },
    };
    if (this.conversationId) body.conversation_id = this.conversationId;

    const res = await this._cf.fetch(BASE + "/backend-anon/f/conversation", {
      method: "POST",
      headers: {
        ...this._headers({}, "POST"),
        "oai-csrf-token": csrf,
        "accept": "text/event-stream",
        "openai-sentinel-chat-requirements-token": this.sentinelToken,
        "openai-sentinel-proof-token": proofToken,
        "x-conduit-token": conduitToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-openai-target-path": "/backend-api/f/conversation",
        "x-openai-target-route": "/backend-api/f/conversation",
        "x-oai-turn-trace-id": crypto.randomUUID(),
        "oai-echo-logs": `0,${t1},1,${t2}`,
      },
      body: JSON.stringify(body),
    });

    const text = res.data;

    if (res.error) {
      throw new Error(`Conversation failed (${res.status}): ${text?.substring(0, 200)}`);
    }

    if (text.includes("Unusual activity")) {
      throw new Error("IP flagged by ChatGPT");
    }

    // Use the shared SSE parser
    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  async *streamAsk(message, options = {}) {
    if (!this.accessToken) await this.init();

    const csrf = await this.getCSRFToken();

    // Get sentinel chat requirements + solve PoW + get conduit
    await this.getChatRequirements();

    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;

    const conduitToken = await this.getConduit(!!this.conversationId);

    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(
      this.proofOfWork.seed,
      this.proofOfWork.difficulty,
      this.config
    );
    if (!proofToken) throw new Error("PoW solve failed");

    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(
        this.bytecode,
        this.vmToken,
        "[]"
      );
    }

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    let fileUploads = [];
    if (options.files && options.files.length > 0) {
      if (!this.uploadManager) this.uploadManager = new UploadManager(this);
      for (const fp of options.files) {
        fileUploads.push(await this.uploadManager.uploadFile(fp));
      }
    }

    let convMessage;
    if (fileUploads.length > 0) {
      const { parts, attachments } = buildMultimodalMessage(message, fileUploads);
      convMessage = {
        id: crypto.randomUUID(), author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "multimodal_text", parts },
        metadata: { attachments, selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    } else {
      convMessage = {
        id: crypto.randomUUID(), author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [message] },
        metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    }

    const body = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: options.historyDisabled ?? true,
      conversation_mode: options.forceSearch
        ? { kind: "primary_assistant", tools: [{ type: "search" }] }
        : { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: options.systemHints || [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    if (this.conversationId) body.conversation_id = this.conversationId;

    const res = await this._cf.fetchStream(BASE + "/backend-anon/f/conversation", {
      method: "POST",
      headers: {
        ...this._headers({}, "POST"),
        "oai-csrf-token": csrf,
        "accept": "text/event-stream",
        "openai-sentinel-chat-requirements-token": this.sentinelToken,
        "openai-sentinel-proof-token": proofToken,
        "x-conduit-token": conduitToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-openai-target-path": "/backend-api/f/conversation",
        "x-openai-target-route": "/backend-api/f/conversation",
        "x-oai-turn-trace-id": crypto.randomUUID(),
        "oai-echo-logs": `0,${t1},1,${t2}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Conversation request failed: ${res.status} - ${txt.substring(0, 200)}`);
    }

    for await (const chunk of streamSSEResponse(res)) {
      if (chunk.conversationId) this.conversationId = chunk.conversationId;
      if (chunk.messageId) this.parentMessageId = chunk.messageId;
      yield chunk;
    }
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`)) {
  const email = process.env.EMAIL;
  const password = process.env.PASSWORD;
  const sentinelToken = process.env.SENTINEL_TOKEN || null;
  const envCookies = process.env.COOKIES || null;
  const args = process.argv.slice(2);
  const cookiesFlag = args.indexOf("--cookies");
  const fileFlag = args.indexOf("--file");
  const nameFlag = args.indexOf("--name");
  const birthdayFlag = args.indexOf("--birthday");
  const signupMode = args.includes("--signup");
  const autoSignupMode = args.includes("--auto-signup");
  const files = [];
  let name = "";
  let birthday = "";
  let cookies = envCookies;
  if (cookiesFlag !== -1 && args.length > cookiesFlag + 1) cookies = args[cookiesFlag + 1];
  if (fileFlag !== -1 && args.length > fileFlag + 1) files.push(args[fileFlag + 1]);
  if (nameFlag !== -1 && args.length > nameFlag + 1) name = args[nameFlag + 1];
  if (birthdayFlag !== -1 && args.length > birthdayFlag + 1) birthday = args[birthdayFlag + 1];
  const excluded = new Set();
  if (cookiesFlag !== -1) { excluded.add(cookiesFlag); excluded.add(cookiesFlag + 1); }
  if (fileFlag !== -1) { excluded.add(fileFlag); excluded.add(fileFlag + 1); }
  if (nameFlag !== -1) { excluded.add(nameFlag); excluded.add(nameFlag + 1); }
  if (birthdayFlag !== -1) { excluded.add(birthdayFlag); excluded.add(birthdayFlag + 1); }
  if (signupMode) { const si = args.indexOf("--signup"); if (si !== -1) excluded.add(si); }
  if (autoSignupMode) { const ai = args.indexOf("--auto-signup"); if (ai !== -1) excluded.add(ai); }
  const msg = args.filter((_, i) => !excluded.has(i)).join(" ") || "say hello";

  const client = new ChatGPTAuth({ cookies });
  const interactiveOTP = async (addr) => {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => rl.question(`OTP code sent to ${addr}. Enter code: `, code => { rl.close(); r(code.trim()); }));
  };

  try {
    if (autoSignupMode) {
      console.log("Auto-signup with temp email...");
      const result = await client.autoSignup({ name: name || undefined, birthday: birthday || undefined });
      console.log("Account created! Email:", result.tempEmail, "/ Password:", result.tempPassword);
      console.log("User:", result.session.user?.name || result.session.user?.email || "N/A");
    } else if (email) {
      if (signupMode) {
        console.log("Creating account for", email, "...");
        const session = await client.signup(email, {
          password: password || undefined,
          name: name || undefined,
          birthday: birthday || undefined,
          getOTPCode: interactiveOTP,
        });
        console.log("Account created! User:", session.user?.name || session.user?.email || "N/A");
      } else {
        console.log("Logging in as", email, "...");
        const session = await client.login(email, password || "", sentinelToken,
          password ? null : interactiveOTP
        );
        console.log("Logged in! User:", session.user?.name || session.user?.email || "N/A");
      }
    } else {
      console.error("Usage:");
      console.error("  Cookies:  COOKIES=\"...\" node chatgpt-auth.mjs [message]");
      console.error("  Login:    EMAIL=x PASSWORD=y node chatgpt-auth.mjs [message] [--file path]");
      console.error("  Signup:   EMAIL=x PASSWORD=y node chatgpt-auth.mjs --signup [--name \"John\"] [--birthday 2000-01-15] [--file path]");
      console.error("  Auto:     node chatgpt-auth.mjs --auto-signup [--name \"John\"] [--birthday 2000-01-15] [--file path] \"your message\"");
      console.error("  OTP:      OTP code prompted interactively when needed");
      process.exit(1);
    }
    const opts = files.length > 0 ? { files } : {};
    const res = await client.ask(msg, opts);
    console.log(res || "(empty response)");
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
