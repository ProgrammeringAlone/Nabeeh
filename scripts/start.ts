import "dotenv/config";
import { spawn } from "node:child_process";
import { validateRuntime } from "../server/config.ts";
validateRuntime();
async function task(file: string, migration = false) {
  await new Promise<void>((resolve,reject)=> {
    const child = spawn(process.execPath,["--import","tsx",file],{
      stdio:"inherit",env:{...process.env,...(migration && process.env.DATABASE_MIGRATION_URL ? {DATABASE_URL:process.env.DATABASE_MIGRATION_URL} : {})},
    });
    child.on("error",reject); child.on("exit",code=>code===0 ? resolve() : reject(new Error("Startup task failed: "+file)));
  });
}
await task("scripts/migrate.ts",true);
await task("scripts/release-pack.ts");
if (process.env.ADMIN_USERNAME) await task("scripts/admin.ts");
await import("../server/index.ts");
