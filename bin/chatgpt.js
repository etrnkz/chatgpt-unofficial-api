#!/usr/bin/env node

import { createChatGPT, ChatGPTWeb, ChatGPTApp } from "../src/index.mjs";
import fs from "fs";
import path from "path";

const VERSION = "2.0.0";

const BANNER = `
███  █   █  ███  █████  ███  ████  █████     ███  ████  ███ 
█     █   █ █   █   █   █     █   █   █      █   █ █   █  █  
█     █████ █████   █   █  ██ ████    █      █████ ████   █  
█     █   █ █   █   █   █   █ █       █      █   █ █      █  
 ███  █   █ █   █   █    ███  █       █      █   █ █     ███ 
                 « u n o f f i c i a l   v${VERSION} »
`;

const HELP = `${BANNER}
Dual backend: Web (chatgpt.com) and App (android.chat.openai.com)

Usage:
  chatgpt [command] [prompt] [options]

Commands:
  web [prompt]         Query using the Web backend (chatgpt.com) [default]
  app [prompt]         Query using the Mobile App backend (android.chat.openai.com)
  models               List available models on the mobile backend
  voices               List available voice synthesizers on the web backend

Options:
  --cookies <path>     Path to cookies.json file (web auth)
  --token <token>      Access token / Bearer token (web or app auth)
  --model <model>      Model slug (e.g. auto, gpt-4o, gpt-6, o1)
  --stream             Stream output in real-time
  --file <path>        Attach local file to prompt (web only)
  --proxy <url>        HTTP/SOCKS5 proxy URL
  --help, -h           Show this help message
  --version, -v        Show version

Examples:
  npx chatgpt "Explain quantum computing in one sentence"
  npx chatgpt web "What is the capital of Uganda?"
  npx chatgpt app models
  npx chatgpt web "Summarize this log" --file ./server.log
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  let mode = "web";
  let promptArgs = [...args];

  if (args[0] === "web") {
    mode = "web";
    promptArgs.shift();
  } else if (args[0] === "app" || args[0] === "mobile") {
    mode = "app";
    promptArgs.shift();
  } else if (args[0] === "models") {
    const app = new ChatGPTApp();
    await app.init();
    console.log(JSON.stringify(await app.getModels(), null, 2));
    return;
  } else if (args[0] === "voices") {
    const web = new ChatGPTWeb();
    await web.init();
    console.log(JSON.stringify(await web.getVoices(), null, 2));
    return;
  }

  // Parse flags
  let cookiesFile = null;
  let token = process.env.CHATGPT_TOKEN || null;
  let model = "auto";
  let stream = false;
  let proxy = process.env.PROXY_URL || null;
  const files = [];

  const remaining = [];
  for (let i = 0; i < promptArgs.length; i++) {
    const arg = promptArgs[i];
    if (arg === "--cookies" && i + 1 < promptArgs.length) {
      cookiesFile = promptArgs[++i];
    } else if (arg === "--token" && i + 1 < promptArgs.length) {
      token = promptArgs[++i];
    } else if (arg === "--model" && i + 1 < promptArgs.length) {
      model = promptArgs[++i];
    } else if (arg === "--proxy" && i + 1 < promptArgs.length) {
      proxy = promptArgs[++i];
    } else if (arg === "--file" && i + 1 < promptArgs.length) {
      files.push(promptArgs[++i]);
    } else if (arg === "--stream") {
      stream = true;
    } else {
      remaining.push(arg);
    }
  }

  const prompt = remaining.join(" ").trim();
  if (!prompt) {
    console.error("Error: Please provide a prompt.");
    process.exit(1);
  }

  const client = createChatGPT({
    type: mode,
    cookiesFile,
    accessToken: token,
    proxyUrl: proxy,
  });

  await client.init();

  const t0 = Date.now();
  if (stream) {
    for await (const chunk of client.streamAsk(prompt, { model, files })) {
      if (chunk.text) process.stdout.write(chunk.text);
    }
    process.stdout.write("\n");
  } else {
    const answer = await client.ask(prompt, { model, files });
    console.log(answer);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\n[${mode.toUpperCase()} · ${dt}s]`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
