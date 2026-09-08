import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

import { harvestEquipmentMentions } from "../lib/equipment/equipment-harvest-worker";
import { getEquipmentMentionStats } from "../lib/equipment/mention-resolve";

function ensureEnvLoaded() {
  if (process.env.DATABASE_URL || process.env.COND_BOARD_POSTGRES_URL) return;
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

async function main() {
  ensureEnvLoaded();
  console.log("Starting equipment harvest worker run…");
  const result = await harvestEquipmentMentions({ limit: 1000 });
  console.log("Equipment harvest result:", result);

  const stats = await getEquipmentMentionStats();
  console.log("Current equipment mention aggregate stats:", stats);
}

main().catch(console.error);
