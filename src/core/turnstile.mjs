// Turnstile bytecode decompiler + VM
// Based on realasfngl/ChatGPT decompiler.py + vm.py + parse.py

const INITIAL_MAP = {
  "1": "XOR_STR",
  "2": "SET_VALUE",
  "3": "BTOA",
  "4": "BTOA_2",
  "5": "ADD_OR_PUSH",
  "6": "ARRAY_ACCESS",
  "7": "CALL",
  "8": "COPY",
  "10": "window",
  "11": "GET_SCRIPT_SRC",
  "12": "GET_MAP",
  "13": "TRY_CALL",
  "14": "JSON_PARSE",
  "15": "JSON_STRINGIFY",
  "17": "CALL_AND_SET",
  "18": "ATOB",
  "19": "BTOA_3",
  "20": "IF_EQUAL_CALL",
  "21": "IF_DIFF_CALL",
  "22": "TEMP_STACK_CALL",
  "23": "IF_DEFINED_CALL",
  "24": "BIND_METHOD",
  "27": "REMOVE_OR_SUBTRACT",
  "28": "undefined",
  "25": "undefined",
  "26": "undefined",
  "29": "LESS_THAN",
  "31": "INCREMENT",
  "32": "DECREMENT_AND_EXEC",
  "33": "MULTIPLY",
  "34": "MOVE",
};

function xorStr(e, t) {
  e = String(e); t = String(t); let n = "";
  for (let r = 0; r < e.length; r++)
    n += String.fromCharCode(e.charCodeAt(r) ^ t.charCodeAt(r % t.length));
  return n;
}

class Decompiler {
  static start() {
    this.xorkey = "";
    this.xorkey2 = "";
    this.decompiled = "var mem = {};\n";
    this.arrayDict = {};
    this.vg = 0;
    this.round1 = 0;
    this.found = false;
    this.potential = [];
    this.mapping = {};
  }

  static handleOp(operation, args) {
    const k = (v) => `var_${String(v).replace(/\./g, "_")}`;

    switch (operation) {
      case "COPY":
        this.mapping[args[0]] = this.mapping[args[1]];
        break;

      case "SET_VALUE": {
        const vn = k(args[0]);
        const val = args[1];
        if (val === "[]") {
          this.decompiled += `var ${vn} = [];\n`;
          this.arrayDict[args[0]] = [];
        } else if (val === "None" || val === null || val === undefined) {
          this.decompiled += `var ${vn} = null;\n`;
          this.arrayDict[args[0]] = "null";
        } else if (!isNaN(Number(val)) && val !== "") {
          const num = Number(val);
          this.decompiled += `var ${vn} = ${num};\n`;
          this.arrayDict[args[0]] = String(num);
        } else {
          this.decompiled += `var ${vn} = "${String(val)}";\n`;
          this.arrayDict[args[0]] = `"${String(val)}"`;
        }
        break;
      }

      case "ARRAY_ACCESS": {
        const v0 = k(args[0]), v1 = k(args[1]), v2 = k(args[2]);
        if (this.decompiled.includes(`var ${v1} =`)) {
          if (args[2] in this.arrayDict && !(args[1] in this.arrayDict)) {
            this.decompiled += `var ${v0} = ${v1}[${this.arrayDict[args[2]]}];\n`;
          } else if (args[1] in this.arrayDict && !(args[2] in this.arrayDict)) {
            this.decompiled += `var ${v0} = ${this.arrayDict[args[1]]}[${v2}];\n`;
          } else if (args[1] in this.arrayDict && args[2] in this.arrayDict) {
            this.decompiled += `var ${v0} = ${this.arrayDict[args[1]]}[${this.arrayDict[args[2]]}];\n`;
          } else {
            this.decompiled += `var ${v0} = ${v1}[${v2}];\n`;
          }
        } else {
          this.decompiled += `var ${v0} = window[${v2}];\n`;
        }
        break;
      }

      case "BIND_METHOD": {
        const v0 = k(args[0]), v1 = k(args[1]), v2 = k(args[2]);
        if (args[1] in this.arrayDict) {
          this.decompiled += `var ${v0} = ${this.arrayDict[args[1]]}[${v2}].bind(${this.arrayDict[args[1]]});\n`;
        } else if (args[2] in this.arrayDict) {
          this.decompiled += `var ${v0} = ${v1}[${this.arrayDict[args[2]]}].bind(${v1});\n`;
        } else {
          this.decompiled += `var ${v0} = ${v1}[${v2}].bind(${v1});\n`;
        }
        break;
      }

      case "XOR_STR":
        if (this.round1 === 1 && this.potential.length < 2) {
          this.potential.push({ var: args[0], key: args[1] });
        }
        this.decompiled += `var ${k(args[0])} = XOR_STR(${k(args[0])}, ${k(args[1])});\n`;
        break;

      case "BTOA_3":
        this.decompiled += `var ${k(args[0])} = btoa("" + ${k(args[0])});\n`;
        break;

      case "CALL_AND_SET": {
        const aStr = args.slice(2).map(a => k(a)).join(", ");
        this.decompiled += `var ${k(args[0])} = ${k(args[1])}(${aStr});\n`;
        break;
      }

      case "IF_DEFINED_CALL":
        this.handleIfDefined(args);
        break;

      case "CALL":
        this.handleCall(args);
        break;

      case "ADD_OR_PUSH":
        this.decompiled += `var ${k(args[0])} = Array.isArray(${k(args[0])}) ? (${k(args[0])}.push(${k(args[1])}), ${k(args[0])}) : ${k(args[0])} + ${k(args[1])};\n`;
        break;

      case "IF_DIFF_CALL": {
        const v0 = k(args[0]), v1 = k(args[1]), v2 = k(args[2]);
        if (this.mapping[args[3]] === "COPY") {
          this.decompiled += `Math.abs(${v0} - ${v1}) > ${v2} ? ${k(args[4])} = ${k(args[5])} : null;\n`;
        } else {
          const aStr = args.slice(4).map(a => k(a)).join(", ");
          this.decompiled += `Math.abs(${v0} - ${v1}) > ${v2} ? ${this.mapping[args[3]]}(${aStr}) : null;\n`;
        }
        break;
      }

      case "TRY_CALL":
        this.handleTryCall(args);
        break;

      case "JSON_STRINGIFY":
        this.decompiled += `var ${k(args[0])} = JSON.stringify(${k(args[0])});\n`;
        break;

      case "MOVE":
        break;

      default: {
        const mapped = args.slice(1).filter(a => a in this.mapping).map(a => this.mapping[a]);
        const unlabeled = args.slice(1).filter(a => !(a in this.mapping)).map(String);
        this.decompiled += `// UNKNOWN: ${operation} -> ${args[0]} ${[...mapped, ...unlabeled].join(" ")};\n`;
      }
    }
  }

  static handleTryCall(args) {
    const target = `var_${String(args[0]).replace(/\./g, "_")}`;
    const fn = this.mapping[args[1]] || "";
    const restArgs = args.slice(2).map(a => `var_${String(a).replace(/\./g, "_")}`);
    if (fn === "ARRAY_ACCESS") {
      this.decompiled += `try { mem[${restArgs[0]}] = ${restArgs[1]}[${restArgs[0]}]; } catch(r) { ${target} = "" + r; }\n`;
    } else {
      this.decompiled += `try { ${fn}(${restArgs.join(", ")}); } catch(r) { ${target} = "" + r; }\n`;
    }
  }

  static handleIfDefined(args) {
    const k = (v) => `var_${String(v).replace(/\./g, "_")}`;
    const v0 = k(args[0]);

    if (args.length === 4) {
      const target = k(args[3]);
      const count = (this.decompiled.match(new RegExp(target.replace("$", "\\$"), "g")) || []).length;
      if (count <= 1 && !this.decompiled.includes(`var ${k(args[2])} =`)) {
        if (!this.xorkey) this.xorkey = String(args[3]);
        this.decompiled += `var ${v0} = ${v0} !== void 0 ? (${this.mapping[args[1]]}("${args[2]}", "${args[3]}") || ${v0}) : ${v0};\n`;
      } else if (count <= 3) {
        this.decompiled += `var ${v0} = ${v0} !== void 0 ? (${this.mapping[args[1]]}(${k(args[2])}, mem["${args[3]}"]) || ${v0}) : ${v0};\n`;
      } else {
        const aStr = args.slice(2).map(a => k(a)).join(", ");
        this.decompiled += `var ${v0} = ${v0} !== void 0 ? (${this.mapping[args[1]]}(${aStr}) || ${v0}) : ${v0};\n`;
      }
    } else {
      const aStr = args.slice(2).map(a => k(a)).join(", ");
      this.decompiled += `var ${v0} = ${v0} !== void 0 ? (${this.mapping[args[1]]}(${aStr}) || ${v0}) : ${v0};\n`;
    }
  }

  static handleCall(args) {
    const k = (v) => `var_${String(v).replace(/\./g, "_")}`;
    if (args[0] in this.mapping) {
      if (this.mapping[args[0]] === "BTOA") {
        this.decompiled += `console.log(btoa("" + ${k(args[1])}));\n`;
      } else {
        const aStr = args.map(a => k(a)).join(", ");
        this.decompiled += `${this.mapping[args[0]]}(${aStr});\n`;
      }
    } else {
      const aStr = args.slice(1).map(a => k(a)).join(", ");
      this.decompiled += `${k(args[0])}(${aStr});\n`;
    }
    if (!this.found) {
      for (const entry of this.potential) {
        if (args.length > 3 && entry.var === String(args[3])) {
          const keyName = String(entry.key).replace(/\./g, "_");
          const match = this.decompiled.match(new RegExp(`var var_${keyName.replace("$", "\\$")} = (.*);`));
          if (match) {
            this.xorkey2 = match[1].replace(";", "").trim();
            this.found = true;
          }
          break;
        }
      }
    }
  }

  static removeUnused() {
    const lines = this.decompiled.split("\n");
    const varDeclLines = [];
    const usedVars = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^var\s+var_([\w_]+)\s*=/);
      if (m) varDeclLines.push({ name: m[1], index: i });
    }
    for (const v of varDeclLines) {
      const name = v.name;
      const isUsed = lines.some((line, idx) =>
        idx !== v.index && line.includes(name) && !line.startsWith(`var var_${name} =`)
      );
      if (isUsed) usedVars.add(name);
    }
    this.decompiled = lines.filter(line => {
      const m = line.match(/^var\s+var_([\w_]+)\s*=/);
      return !m || usedVars.has(m[1]);
    }).join("\n");
  }

  static decompile(bytecode) {
    while (bytecode.length > 0) {
      const op = bytecode.shift();
      const e = String(op[0]);
      const t = op.slice(1).map(String);

      if (e in this.mapping) {
        this.handleOp(this.mapping[e], t);
      } else {
        this.decompiled += `// UNKNOWN_OPCODE ${e} -> ${t.join(", ")};\n`;
      }
    }

    if (this.round1 === 0) {
      this.round1++;
      this.decompile2();
    }
  }

  static decompile2() {
    const matches = [...this.decompiled.matchAll(/var\s+\w+\s*=\s*(["'`])([\s\S]*?)\1/g)];
    const bytecodes = matches.map(m => m[2]);
    const longest = bytecodes.reduce((a, b) => a.length >= b.length ? a : b, "");
    if (longest) {
      try {
        const decoded = xorStr(Buffer.from(longest, "base64").toString("utf-8"), String(this.xorkey));
        const inner = JSON.parse(decoded);
        this.decompile(inner);
      } catch (e) {
        // ignore parse errors
      }
    }

    if (this.round1 === 1) {
      this.round1++;
      this.decompile3();
    }
  }

  static decompile3() {
    const matches = [...this.decompiled.matchAll(/var\s+\w+\s*=\s*(["'`])([\s\S]*?)\1/g)];
    const candidates = matches.map(m => m[2]).filter(s => s.length >= 60 && s.length <= 200);
    if (candidates.length > 0) {
      try {
        const decoded = xorStr(Buffer.from(candidates[0], "base64").toString("utf-8"), String(this.xorkey));
        const inner = JSON.parse(decoded);
        this.decompile(inner);
      } catch (e) {
        // ignore
      }
    }
    this.removeUnused();
  }

  static decompileVM(turnstile, token) {
    this.start();
    this.mapping = { ...INITIAL_MAP };
    this.decompiled =
      'var mem = {};\n';

    const buf = Buffer.from(turnstile, "base64");
    const decoded = xorStr(buf.toString("binary"), String(token));
    const bytecode = JSON.parse(decoded);
    this.decompile(bytecode);
    return this.decompiled;
  }
}

class Parser {
  static parseKeys(decompiledCode) {
    let xorKey = null;

    // Find XOR key: look for XOR_STR calls where one arg is a string constant
    const xorMatches = decompiledCode.matchAll(/XOR_STR\(var_(\w+),\s*var_(\w+)\)/g);
    for (const m of xorMatches) {
      const keyVar = m[2];
      const valMatch = decompiledCode.match(new RegExp(`var var_${keyVar.replace("$", "\\$")}\\s*=\\s*"([^"]*)"`));
      if (valMatch) {
        xorKey = valMatch[1];
        break;
      }
    }

    // If no XOR key found, try to find any string assigned to a variable
    if (!xorKey) {
      const strAssignments = decompiledCode.matchAll(/var var_(\w+)\s*=\s*"([^"]+)"/g);
      for (const m of strAssignments) {
        if (m[2].length > 5 && !m[2].includes("http")) {
          xorKey = m[2];
          break;
        }
      }
    }

    // Find variable-to-type mappings
    const keys = {};
    const lines = decompiledCode.split("\n");
    for (const line of lines) {
      const varMatch = line.match(/var var_(\w+)\s*=\s*(.+)/);
      if (!varMatch) continue;
      const varName = varMatch[1];
      const value = varMatch[2].trim().replace(/;$/, "");

      if (line.includes("location") && !line.includes("window")) {
        if (!(varName in keys)) keys[varName] = "location";
      } else if (line.includes("maxTouchPoints") || line.includes("vendor")) {
        if (!(varName in keys)) keys[varName] = "vendor";
      } else if (line.includes("history") && line.includes("length")) {
        if (!(varName in keys)) keys[varName] = "history";
      } else if (line.includes("random") && !line.includes("Math.abs")) {
        if (!(varName in keys)) keys[varName] = "random";
      } else if (line.includes("cfIpLongitude") || line.includes("ipLongitude") || line.includes("latitude")) {
        if (!(varName in keys)) keys[varName] = "ipinfo";
      } else if (line.includes("createElement") || (line.includes("element") && !line.includes("remove"))) {
        if (!(varName in keys)) keys[varName] = "element";
      } else if (line.includes("localStorage") || line.includes('Object.keys') || line.includes('localstorage')) {
        if (!(varName in keys)) keys[varName] = "localstorage";
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        if (!(varName in keys)) keys[varName] = value;
      }
    }

    return { xorKey, keys };
  }
}

const HTML_OBJECT = JSON.stringify({
  x: 0, y: 1219, width: 37.8125, height: 30,
  top: 1219, right: 37.8125, bottom: 1249, left: 0
});

export class TurnstileVM {
  static generateTurnstile(turnstileDx, token, ipInfo) {
    const decompiled = Decompiler.decompileVM(turnstileDx, token);
    const { xorKey, keys } = Parser.parseKeys(decompiled);
    const effectiveKey = xorKey || token;
    const payload = {};

    for (const [key, value] of Object.entries(keys)) {
      const valStr = String(value);

      if (valStr.startsWith("random")) {
        payload[key] = Buffer.from(xorStr(String(Math.random()), xorKey || String(Math.random()))).toString("base64");
      } else if (valStr === "ipinfo") {
        payload[key] = Buffer.from(xorStr(ipInfo, effectiveKey)).toString("base64");
      } else if (valStr === "element") {
        payload[key] = Buffer.from(xorStr(HTML_OBJECT, effectiveKey)).toString("base64");
      } else if (valStr === "location") {
        payload[key] = Buffer.from(xorStr("https://chatgpt.com/", effectiveKey)).toString("base64");
      } else if (valStr === "vendor") {
        payload[key] = Buffer.from(xorStr('["Google Inc.","Win32",8,0]', effectiveKey)).toString("base64");
      } else if (valStr === "localstorage") {
        payload[key] = Buffer.from(xorStr("oai/apps/hasDismissedTeamsNoAuthUpsell,oai/apps/lastSeenNoAuthTrialsBannerAt,oai-did,oai/apps/noAuthGoUpsellModalDismissed,oai/apps/hasDismissedBusinessFreeTrialUpsellModal,oai/apps/capExpiresAt,statsig.session_id.1792610830,oai/apps/hasSeenNoAuthImagegenNux,oai/apps/lastPageLoadDate,client-correlated-secret,statsig.stable_id.1792610830,oai/apps/debugSettings,oai/apps/hasDismissedPlusFreeTrialUpsellModal,oai/apps/tatertotInContextUpsellBannerV2,search.attributions-settings", effectiveKey)).toString("base64");
      } else if (valStr === "history") {
        payload[key] = Buffer.from(xorStr(String(Math.floor(Math.random() * 5) + 1), effectiveKey)).toString("base64");
      } else if (!isNaN(Number(valStr))) {
        payload[key] = Buffer.from(xorStr(valStr, effectiveKey)).toString("base64");
      } else {
        payload[key] = Buffer.from(xorStr(valStr, effectiveKey)).toString("base64");
      }
    }

    const payloadJson = JSON.stringify(payload);
    const turnstileToken = Buffer.from(xorStr(payloadJson, effectiveKey)).toString("base64");
    return turnstileToken;
  }
}
