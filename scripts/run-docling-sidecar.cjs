/**
 * Start the local Docling sidecar for Extraction Lab A/B.
 * Requires `.venv-docling` with docling + fastapi/uvicorn installed.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const python = path.join(
  root,
  ".venv-docling",
  isWin ? "Scripts" : "bin",
  isWin ? "python.exe" : "python",
);
const attachmentsRoot = path.join(root, "data", "email-attachments");
const host = process.env.DOCLING_SIDECAR_HOST || "127.0.0.1";
const port = process.env.DOCLING_SIDECAR_PORT || "5001";

if (!fs.existsSync(python)) {
  console.error(
    `[docling-sidecar] Missing ${python}\n` +
      "Create the venv and install deps:\n" +
      "  python -m venv .venv-docling\n" +
      "  .venv-docling\\Scripts\\pip install docling -r services/docling-sidecar/requirements.txt\n",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  TORCHDYNAMO_DISABLE: "1",
  TORCH_COMPILE_DISABLE: "1",
  ATTACHMENTS_ROOT: process.env.ATTACHMENTS_ROOT || attachmentsRoot,
};

console.log(
  `[docling-sidecar] starting on http://${host}:${port} (attachments: ${env.ATTACHMENTS_ROOT})`,
);

const child = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "app:app",
    "--app-dir",
    path.join(root, "services", "docling-sidecar"),
    "--host",
    host,
    "--port",
    String(port),
  ],
  {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[docling-sidecar] exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
