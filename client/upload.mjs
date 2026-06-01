import crypto from "crypto";
import fs from "fs";
import path from "path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const BASE = "https://chatgpt.com";

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".md": "text/markdown",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
};

export function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export function getFileUseCase(mimeType) {
  if (mimeType.startsWith("image/")) return "multimodal";
  return "multimodal";
}

function getImageDimensions(buffer) {
  const magic = buffer.readUInt32BE(0);
  if (magic === 0x89504e47) {
    if (buffer.length < 24) return { width: 0, height: 0 };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if ((magic & 0xffffff00) === 0xffd8ff00) {
    let offset = 2;
    let maxIter = 1000;
    while (offset < buffer.length - 1 && maxIter-- > 0) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (offset + 9 > buffer.length) break;
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (offset + 3 > buffer.length) break;
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2) { offset++; continue; }
      offset += 2 + segLen;
    }
  }
  return { width: 0, height: 0 };
}

export class UploadManager {
  constructor(client) {
    this.client = client;
  }

  async _fetch(path, opts = {}) {
    const headers = {
      "user-agent": UA,
      ...(opts.headers || {}),
    };
    if (this.client.deviceId) headers["oai-device-id"] = this.client.deviceId;
    if (this.client.buildId) headers["oai-client-version"] = this.client.buildId;
    if (this.client.accessToken) headers["authorization"] = `Bearer ${this.client.accessToken}`;
    const url = path.startsWith("http") ? path : BASE + path;
    const result = await this.client._cf.fetch(url, { ...opts, headers, retries: 2 });
    return {
      ok: !result.error,
      status: result.status,
      headers: result.headers,
      json: async () => { try { return JSON.parse(result.data); } catch { return null; } },
      text: async () => result.data,
    };
  }

  async uploadFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    const fileName = crypto.randomUUID() + path.extname(filePath);
    const fileSize = buffer.length;
    const mimeType = detectMimeType(filePath);
    const isImage = mimeType.startsWith("image/");
    const useCase = getFileUseCase(mimeType);

    let width = 0, height = 0;
    if (isImage) {
      const dims = getImageDimensions(buffer);
      width = dims.width;
      height = dims.height;
    }

    // Step 1: Create file upload
    const createRes = await this._fetch("/backend-anon/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_name: fileName,
        file_size: fileSize,
        use_case: useCase,
        timezone_offset_min: this.client.timezoneOffset,
        reset_rate_limits: false,
      }),
    });
    const createData = await createRes.json();
    const fileId = createData.file_id;
    const uploadUrl = createData.upload_url;
    if (!fileId || !uploadUrl) throw new Error("File upload init failed: " + JSON.stringify(createData));

    // Step 2: Upload binary data to Azure blob
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "content-type": mimeType,
        "content-length": String(fileSize),
      },
      body: buffer,
    });
    if (!uploadRes.ok) throw new Error(`Binary upload failed: ${uploadRes.status}`);

    // Step 3: Process uploaded file
    const processRes = await this._fetch("/backend-anon/files/process_upload_stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        use_case: useCase,
        index_for_retrieval: false,
        file_name: fileName,
      }),
    });
    const processText = await processRes.text();
    if (!processText.includes("Succeeded processing")) {
      throw new Error("File processing failed: " + processText.substring(0, 200));
    }

    return {
      fileId,
      fileName,
      fileSize,
      mimeType,
      width,
      height,
    };
  }

  async uploadImage(filePath) {
    const info = await this.uploadFile(filePath);
    return {
      assetPointer: `file-service://${info.fileId}`,
      sizeBytes: info.fileSize,
      width: info.width,
      height: info.height,
      fileName: info.fileName,
      mimeType: info.mimeType,
      fileId: info.fileId,
      fileSize: info.fileSize,
    };
  }

  async uploadFromBase64(base64Data, ext = ".png") {
    const buffer = Buffer.from(base64Data, "base64");
    const tmpPath = path.join(process.cwd(), crypto.randomUUID() + ext);
    fs.writeFileSync(tmpPath, buffer);
    try {
      return await this.uploadFile(tmpPath);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }
}

export function buildMultimodalMessage(text, uploads) {
  const attachments = [];

  for (const u of uploads) {
    attachments.push({
      id: u.fileId,
      size: u.fileSize || u.sizeBytes,
      name: u.fileName,
      mime_type: u.mimeType,
      width: u.width || undefined,
      height: u.height || undefined,
      source: "local",
    });
  }

  const parts = [text];

  return { parts, attachments };
}

export async function fetchVoices(client) {
  const headers = {
    "user-agent": UA,
  };
  if (client.deviceId) headers["oai-device-id"] = client.deviceId;
  if (client.buildId) headers["oai-client-version"] = client.buildId;

  const res = await fetch(BASE + "/backend-anon/settings/voices", { headers });
  if (!res.ok) throw new Error(`Voices fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchVoiceSettings(client) {
  const headers = {
    "user-agent": UA,
  };
  if (client.deviceId) headers["oai-device-id"] = client.deviceId;
  if (client.buildId) headers["oai-client-version"] = client.buildId;

  const res = await fetch(BASE + "/backend-anon/settings/voice_settings", { headers });
  if (!res.ok) throw new Error(`Voice settings fetch failed: ${res.status}`);
  return res.json();
}
