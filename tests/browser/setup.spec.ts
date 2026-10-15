import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { candidateSchema, insertQuestion } from "../../server/content.ts";
let hardId: string, mixedId: string;
const hardName = "فئة صعبة فقط",
  mixedName = "فئة بمستويات متنوعة";
test.beforeAll(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_e2e")
  )
    throw new Error("Setup fixtures require an isolated browser database.");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  hardId = "setup_hard_" + randomUUID().slice(0, 8);
  mixedId = "setup_mixed_" + randomUUID().slice(0, 8);
  for (const [id, name] of [
    [hardId, hardName],
    [mixedId, mixedName],
  ])
    await db.query(
      "INSERT INTO categories(id,name,description,icon,color) VALUES($1,$2,'اختبار نشر جزئي','◇','#eee')",
      [id, name],
    );
  const pack = JSON.parse(await readFile("media/release-pack.json", "utf8"));
  for (const [i, q] of pack.questions
    .filter((q: any) => q.categoryIds[0] === "logic")
    .entries())
    await insertQuestion(
      db,
      candidateSchema.parse({
        ...q,
        text: q.text + " (" + mixedId + ")",
        factKey: mixedId + ":" + i,
        subject: mixedId + ":" + i,
        categoryIds: [mixedId],
      }),
    );
  for (let i = 0; i < 3; i++) {
    const a = 70000 + i,
      answer = String(a + 37);
    await insertQuestion(
      db,
      candidateSchema.parse({
        text: `كم يساوي ${a} زائد 37؟ (${hardId})`,
        answer,
        fact: `${a}+37=${answer}`,
        factKey: hardId + ":" + i,
        subject: hardId + ":" + i,
        predicate: "add",
        categoryIds: [hardId],
        difficulty: "hard",
        deterministic: true,
        provenance: "Isolated partial-publication fixture",
        hint: "اجمع العددين.",
        explanation: "الجمع المباشر يعطي " + answer,
      }),
    );
  }
  await db.end();
});
test("Partial publication and seen questions cannot select an incomplete mixed board", async ({
  page,
}) => {
  await page.addInitScript(
    (id) => sessionStorage.setItem("nabeeh-category", id),
    hardId,
  );
  await page.route("**/api/categories*", async (route) => {
    const response = await route.fetch(),
      rows = await response.json();
    const filtered = rows
      .filter((c: any) => c.id === hardId || c.id === mixedId)
      .sort((a: any) => (a.id === hardId ? -1 : 1));
    await route.fulfill({ response, json: filtered });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: new RegExp(mixedName) }),
  ).toBeVisible();
  await page.getByRole("button", { name: /جولة حقيقية/ }).click();
  await expect(
    page.getByRole("heading", { name: /اختاروا تحدّيكم/ }),
  ).toBeVisible();
  const demoId = page.url().split("/").pop()!;
  const demo = await (await page.request.get("/api/games/" + demoId)).json();
  expect(demo.categories[0].id).toBe(mixedId);
  const headers = { "X-Nabeeh-Request": "1" };
  expect(
    (
      await page.request.post(`/api/games/${demoId}/abandon`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(200);
  await page.goto("/#/setup");
  const hard = page
    .locator(".category-option")
    .filter({ has: page.getByText(hardName, { exact: true }) });
  const mixed = page
    .locator(".category-option")
    .filter({ has: page.getByText(mixedName, { exact: true }) });
  await expect(hard).toBeDisabled();
  await expect(mixed).toHaveAttribute("aria-pressed", "true");
  const counts = async () => {
    const rows = await (await page.request.get("/api/categories")).json();
    return rows.find((c: any) => c.id === mixedId);
  };
  for (let i = 0; i < 2; i++) {
    const create = await page.request.post("/api/games", {
      headers,
      data: { categoryIds: [mixedId], teamNames: ["ألف", "باء"], timer: 180 },
    });
    expect(create.status()).toBe(201);
    const { id } = await create.json(),
      board = await (await page.request.get("/api/games/" + id)).json();
    if (i === 0) {
      const c = await counts();
      expect([c.available, c.easy, c.medium, c.hard]).toEqual([3, 1, 1, 1]);
    }
    const tile = board.tiles.find((t: any) => t.value === 200);
    expect(
      (
        await page.request.post(`/api/games/${id}/open`, {
          headers,
          data: { instanceId: tile.id },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(`/api/games/${id}/abandon`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(200);
  }
  const remaining = await counts();
  expect([
    remaining.available,
    remaining.easy,
    remaining.medium,
    remaining.hard,
  ]).toEqual([4, 0, 2, 2]);
  await page.reload();
  await expect(hard).toBeDisabled();
  await expect(mixed).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "ابدأ اللعبة", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "الصعوبة", exact: true })
    .selectOption("hard");
  await expect(hard).toHaveAttribute("aria-pressed", "true");
  await expect(hard).toBeEnabled();
  await expect(mixed).toBeDisabled();
  await page
    .getByRole("button", { name: "اختيار عشوائي", exact: true })
    .click();
  await expect(hard).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /اختاروا تحدّيكم/ }),
  ).toBeVisible();
  const game = await (
    await page.request.get("/api/games/" + page.url().split("/").pop())
  ).json();
  expect(game.categories[0].id).toBe(hardId);
  expect(game.tiles).toHaveLength(3);
});
