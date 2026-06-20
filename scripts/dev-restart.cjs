"use strict";

const { execSync, spawn } = require("child_process");
const path = require("path");

const PORT = 3010;
const root = path.join(__dirname, "..");

function killPort(port) {
  if (process.platform === "win32") {
    try {
      const output = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set();

      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        if (!line.includes(`:${port}`)) continue;

        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== "0") {
          pids.add(pid);
        }
      }

      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        } catch {
          // Process may have already exited.
        }
      }
    } catch {
      // Nothing listening on the port.
    }
    return;
  }

  try {
    const pids = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (!pids) return;

    for (const pid of pids.split(/\s+/)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // Process may have already exited.
      }
    }
  } catch {
    // Nothing listening on the port.
  }
}

killPort(PORT);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCmd, ["run", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
