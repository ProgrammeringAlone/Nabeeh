import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

const headers = { "X-Nabeeh-Request": "1" };
async function finishGame(page: Page, explicitTeam: boolean, names: [string, string]) {
  const create = await page.request.post("/api/games", { headers, data: {
    categoryIds: ["logic"], teamNames: names, timer: 180,
    ...(explicitTeam ? { hostTeam: 1 } : {}),
  } });
  expect(create.status()).toBe(201);
  const { id } = await create.json();
  const game = await (await page.request.get("/api/games/" + id)).json();
  for (const tile of game.tiles) {
    expect((await page.request.post(`/api/games/${id}/open`, { headers, data: { instanceId: tile.id } })).status()).toBe(200);
    expect((await page.request.post(`/api/games/${id}/reveal`, { headers, data: {} })).status()).toBe(200);
    const score = { instanceId: tile.id, outcome: "correct", team: explicitTeam ? 1 : 0 };
    expect((await page.request.post(`/api/games/${id}/score`, { headers, data: score })).status()).toBe(200);
    expect((await page.request.post(`/api/games/${id}/score`, { headers, data: score })).status()).toBe(200);
  }
  expect((await (await page.request.get("/api/games/" + id)).json()).status).toBe("finished");
}

test("Public leaderboard respects opt-in, recorded team credit, historical assignments and privacy withdrawal", async ({ page }) => {
  await page.goto("/#/leaderboard");
  await expect(page.getByRole("heading", { name: "لوحة الصدارة", exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  expect((await page.request.get("/api/account/leaderboard")).status()).toBe(401);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = "rank_" + suffix, password = "leaderboard browser password " + suffix;
  const signup = await page.request.post("/api/auth/register", { headers, data: { username, password } });
  expect(signup.status()).toBe(200);
  try {
    expect((await (await page.request.get("/api/account/leaderboard")).json()).enabled).toBe(false);
    await finishGame(page, false, ["قديم " + suffix, "خصم قديم " + suffix]);
    await finishGame(page, true, ["المنافسون " + suffix, "الصدارة " + suffix]);
    await page.reload();
    const preference = page.getByRole("switch", { name: "إظهار حسابي وفرقي" });
    await expect(preference).toBeEnabled(); await expect(preference).not.toBeChecked();
    await expect(page.locator("tbody tr").filter({ hasText: username })).toHaveCount(0);
    // Visibility is confirmed by the server before this controlled switch
    // changes. click() allows its asynchronous save; check() requires the new
    // state immediately after dispatching the input event.
    await preference.click();
    await expect(preference).toBeChecked();
    await expect(page.locator("tbody tr").filter({ hasText: username })).toHaveCount(1);
    const stats = (await (await page.request.get("/api/leaderboard")).json()).entries.find((entry: any) => entry.name === username);
    expect(stats).toMatchObject({ points: 1200, games: 1, wins: 1 });
    expect(Object.keys(stats).sort()).toEqual(["games", "name", "points", "rank", "wins"]);
    await page.getByRole("button", { name: "الفرق", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: username })).toHaveCount(4);
    await page.getByRole("button", { name: "مرات الفوز", exact: true }).click();
    await expect(page.getByRole("button", { name: "مرات الفوز", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/leaderboard-${test.info().project.name}.png`, fullPage: true });
    await preference.click();
    await expect(preference).not.toBeChecked();
    await expect(page.locator("tbody tr").filter({ hasText: username })).toHaveCount(0);
    await page.getByRole("button", { name: "اللاعبون", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: username })).toHaveCount(0);
  } finally {
    expect((await page.request.delete("/api/account", { headers, data: { confirm: "DELETE", password } })).status()).toBe(200);
  }
});
