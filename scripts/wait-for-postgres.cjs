const { Client } = require("pg");

const connectionString =
  process.env.COND_BOARD_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgresql://condo:condo@db:5432/condo_board";

const isSupabase =
  /supabase\.(co|com)|pooler\.supabase\.com/i.test(connectionString);
const ssl =
  isSupabase && process.platform === "win32"
    ? { rejectUnauthorized: false }
    : undefined;
let connectUrl = connectionString;
if (ssl) {
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    connectUrl = parsed.toString();
  } catch {
    connectUrl = connectionString.replace(/[?&]sslmode=[^&]+/gi, "");
  }
}

const client = new Client({
  connectionString: connectUrl,
  connectionTimeoutMillis: 3000,
  ssl,
});

client
  .connect()
  .then(() => client.end())
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
