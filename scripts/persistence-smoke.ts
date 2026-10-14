import { writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const origin = process.env.APP_ORIGIN || "http://localhost:3000",
  file = ".local/persistence-smoke.json";
if (process.argv[2] === "prepare") {
  const me = await fetch(origin + "/api/me"),
    cookie = me.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing guest cookie");
  const headers = {
    "Content-Type": "application/json",
    "X-Nabeeh-Request": "1",
    Cookie: cookie,
  };
  const r = await fetch(origin + "/api/games", {
    method: "POST",
    headers,
    body: JSON.stringify({
      categoryIds: ["logic"],
      teamNames: ["اختبار الثبات", "المنافسون"],
      timer: 180,
    }),
  });
  if (!r.ok) throw new Error("Create failed");
  const { id } = (await r.json()) as { id: string };
  const state: any = await (
      await fetch(origin + "/api/games/" + id, { headers })
    ).json(),
    instanceId = state.tiles[0].id;
  const open = await fetch(origin + "/api/games/" + id + "/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ instanceId }),
  });
  if (!open.ok) throw new Error("Open failed");
  await writeFile(file, JSON.stringify({ cookie, id, instanceId }), {
    mode: 0o600,
  });
  console.log(
    "Prepared persistent guest and open question; no credential values logged.",
  );
} else {
  const saved = JSON.parse(await readFile(file, "utf8")),
    headers = {
      "Content-Type": "application/json",
      "X-Nabeeh-Request": "1",
      Cookie: saved.cookie,
    };
  const state: any = await (
    await fetch(origin + "/api/games/" + saved.id, { headers })
  ).json();
  if (state.current?.id !== saved.instanceId || state.current.answer !== null)
    throw new Error("Resume lost state or exposed an answer");
  const me: any = await (await fetch(origin + "/api/me", { headers })).json();
  if (me.seen !== 1) throw new Error("Exposure history was not preserved");
  await fetch(origin + "/api/games/" + saved.id + "/abandon", {
    method: "POST",
    headers,
    body: "{}",
  });
  console.log(
    "Guest identity, open question, hidden answer, and exposure survived runtime restart.",
  );
}
