const { Client } = require("pg");

const connectionString =
  process.env.COND_BOARD_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgresql://condo:condo@db:5432/condo_board";

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 3000,
});

client
  .connect()
  .then(() => client.end())
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
