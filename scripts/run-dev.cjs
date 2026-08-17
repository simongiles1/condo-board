"use strict";

const { spawn } = require("child_process");
const path = require("path");

const PORT = 3010;
const HEAP_MB = 8192;
const root = path.join(__dirname, "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const existing = process.env.NODE_OPTIONS || "";
const heapFlag = `--max-old-space-size=${HEAP_MB}`;
const nodeOptions = /max[-_]old[-_]space[-_]size/.test(existing)
  ? existing
  : `${existing} ${heapFlag}`.trim();

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
