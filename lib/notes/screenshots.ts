import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "note-screenshots");

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

export function parseScreenshotDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Buffer;
} | null {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  if (!mimeType.startsWith("image/")) return null;

  try {
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0) return null;
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("webp")) return ".webp";
  return ".bin";
}

export async function ensureScreenshotDir(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
}

export async function saveScreenshotFromDataUrl(
  dataUrl: string,
): Promise<{ id: string; filePath: string; mimeType: string } | null> {
  const parsed = parseScreenshotDataUrl(dataUrl);
  if (!parsed) return null;

  const hash = createHash("sha256").update(parsed.bytes).digest("hex");
  const ext = extensionForMime(parsed.mimeType);
  const id = randomUUID();
  const filePath = path.join(SCREENSHOT_DIR, `${hash}${ext}`);

  await ensureScreenshotDir();
  await writeFile(filePath, parsed.bytes);

  return { id, filePath, mimeType: parsed.mimeType };
}
