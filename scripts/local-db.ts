import EmbeddedPostgres from "embedded-postgres";
import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(".local/postgres");
await mkdir(directory, { recursive: true });
const db = new EmbeddedPostgres({
  databaseDir: directory,
  user: "postgres",
  password: "postgres",
  port: 54329,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: (m) => {
    if (String(m).includes("ready to accept"))
      console.log("Local PostgreSQL ready");
  },
  onError: (m) => console.error(String(m)),
});
try {
  await access(resolve(directory, "PG_VERSION"));
} catch {
  await db.initialise();
}
await db.start();
const client = db.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='nabeeh'"))
    .rowCount
)
  await db.createDatabase("nabeeh");
await client.end();
console.log("PostgreSQL listening on 127.0.0.1:54329; Ctrl+C to stop.");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await db.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
