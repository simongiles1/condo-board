"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(
  root,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const targetDir = path.join(root, "public");
const target = path.join(targetDir, "pdf.worker.min.mjs");

if (!fs.existsSync(source)) {
  console.error(
    "[copy-pdfjs-worker] Missing pdfjs-dist worker. Run npm install first.",
  );
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

const nextContents = fs.readFileSync(source);
if (fs.existsSync(target)) {
  const current = fs.readFileSync(target);
  if (current.equals(nextContents)) {
    process.exit(0);
  }
}

fs.writeFileSync(target, nextContents);
console.info("[copy-pdfjs-worker] Copied pdf.worker.min.mjs to public/");
