export const FILE_PULL_AUTH_HEADER = "authorization";

export type RemoteSourcePullConfig = {
  enabled: boolean;
  productionUrl: string | null;
  token: string | null;
};

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export function getRemoteSourcePullConfig(): RemoteSourcePullConfig {
  const productionUrl = normalizeBaseUrl(process.env.PRODUCTION_APP_URL);
  const token = process.env.FILE_PULL_TOKEN?.trim() || null;
  const enabled =
    process.env.NODE_ENV === "development" && Boolean(productionUrl && token);

  return {
    enabled,
    productionUrl,
    token,
  };
}

export function isRemoteSourcePullEnabled(): boolean {
  return getRemoteSourcePullConfig().enabled;
}

export function readFilePullTokenFromRequest(req: Request): string | null {
  const header = req.headers.get(FILE_PULL_AUTH_HEADER)?.trim();
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice("bearer ".length).trim();
  return token || null;
}

export function isAuthorizedFilePullRequest(req: Request): boolean {
  const expected = process.env.FILE_PULL_TOKEN?.trim();
  if (!expected) return false;
  const provided = readFilePullTokenFromRequest(req);
  return Boolean(provided && provided === expected);
}
