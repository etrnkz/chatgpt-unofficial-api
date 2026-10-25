import { ChatGPTWeb, ChatGPTApp, ChatGPTMobile } from "../src/index.mjs";
export * from "../src/index.mjs";

export const ChatGPT = ChatGPTWeb;
export default ChatGPT;

// Direct CLI execution support
if (process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`)) {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const imageFlag = args.indexOf("--image");
  const cookiesFlag = args.indexOf("--cookies");
  const appFlag = args.includes("--app") || args.includes("--mobile");
  const tokenFlag = args.indexOf("--token");

  const files = [];
  let cookiesFile = null;
  let accessToken = null;
  if (fileFlag !== -1 && args.length > fileFlag + 1) files.push(args[fileFlag + 1]);
  if (imageFlag !== -1 && args.length > imageFlag + 1) files.push(args[imageFlag + 1]);
  if (cookiesFlag !== -1 && args.length > cookiesFlag + 1) cookiesFile = args[cookiesFlag + 1];
  if (tokenFlag !== -1 && args.length > tokenFlag + 1) accessToken = args[tokenFlag + 1];

  const excluded = new Set();
  if (fileFlag !== -1) { excluded.add(fileFlag); excluded.add(fileFlag + 1); }
  if (imageFlag !== -1) { excluded.add(imageFlag); excluded.add(imageFlag + 1); }
  if (cookiesFlag !== -1) { excluded.add(cookiesFlag); excluded.add(cookiesFlag + 1); }
  if (tokenFlag !== -1) { excluded.add(tokenFlag); excluded.add(tokenFlag + 1); }
  if (appFlag) { excluded.add(args.indexOf("--app")); excluded.add(args.indexOf("--mobile")); }

  const msg = args.filter((_, i) => !excluded.has(i)).join(" ") || "say hello";

  const client = appFlag
    ? new ChatGPTApp({ accessToken })
    : new ChatGPTWeb({ cookiesFile, accessToken });

  const start = Date.now();
  await client.init();

  if (appFlag) {
    console.error(`Mode: Mobile App (${client.isAuthenticated ? "authenticated" : "anonymous"})`);
  } else if (client.isAuthenticated) {
    const profile = await client.getProfile();
    console.error(`Logged in as: ${profile?.name || "unknown"} (${profile?.email || "?"})`);
  } else {
    console.error("Mode: Web anonymous");
  }

  const opts = files.length > 0 ? { files } : {};
  try {
    const res = await client.ask(msg, opts);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(res || "(empty response)");
    console.error(`\n(${elapsed}s)`);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
