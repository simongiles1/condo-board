"use strict";

const { spawn } = require("child_process");
const path = require("path");

const PORT = 3010;
const HEAP_MB = 8192;
const root = path.join(__dirname, "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const existing = process.env.NODE_OPTIONS || "";
const extraFlags = [`--max-old-space-size=${HEAP_MB}`, "--dns-result-order=ipv4first"];
let nodeOptions = existing;
for (const flag of extraFlags) {
  const key = flag.split("=")[0];
  if (!nodeOptions.includes(key)) {
    nodeOptions = `${nodeOptions} ${flag}`.trim();
  }
}

const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
