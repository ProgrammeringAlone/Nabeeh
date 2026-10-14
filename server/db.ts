import "dotenv/config";
import pg from "pg";
import { integerSetting } from "./config.ts";
const supplied=process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
let database:URL;
try { database=new URL(supplied); } catch { throw new Error("Invalid DATABASE_URL; check the secure binding."); }
if(!["postgres:","postgresql:"].includes(database.protocol)) throw new Error("DATABASE_URL requires PostgreSQL.");
const mode=database.searchParams.get("sslmode");
const tls=process.env.DATABASE_SSL_REQUIRED==="true" || ["require","verify-ca","verify-full"].includes(mode || "");
if(mode==="no-verify" || (tls && mode==="disable")) throw new Error("Database TLS verification must remain enabled.");
if(tls){database.searchParams.delete("sslmode");database.searchParams.delete("uselibpqcompat");}
export const pool = new pg.Pool({
  connectionString: database.href,
  ...(tls?{ssl:{rejectUnauthorized:true}}:{}),
  enableChannelBinding:true,
  max: integerSetting("DB_POOL_MAX", 10, 1, 100),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: integerSetting("DB_STATEMENT_TIMEOUT_MS", 15000, 1000, 120000),
});
pool.on("error", (error) =>
  console.error(
    JSON.stringify({ level: "error", code: "DB_POOL", message: error.message }),
  ),
);
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
