import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";

test("Suggestions explain disabled model generation and preserve manual targets, including an explicit textual alternative for advanced formats", async ({ page }) => {
  const connection = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh_e2e";
  if (!new URL(connection).pathname.endsWith("_e2e")) throw new Error("Suggestions browser tests require the isolated _e2e database.");
  const db = new pg.Client({ connectionString: connection });
  await db.connect();
  const username = `suggest_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  try {
    await page.goto("/");
    expect((await page.request.get("/api/admin/suggestions")).status()).toBe(403);
    const registered = await page.request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json", "X-Nabeeh-Request": "1" },
      data: { username, password: `Suggestion test ${randomUUID()}` },
    });
    expect(registered.ok()).toBe(true);
    await db.query("UPDATE users SET role='editor' WHERE username=$1", [username]);
    const common = { categoryId: "logic", count: 2, reason: "اقتراح توضيحي حسب نقص الأسئلة التي اعتمدها المحررون.", approvedCount: 0, reviewCount: 2, approvalRate: 100, pendingCount: 0, action: "compose", kind: null };
    // Fixed recommendation fixtures isolate the cross-tab UI contract; the
    // algorithm and database aggregation are tested against real PG separately.
    await page.route("**/api/admin/suggestions", route => route.fulfill({
      json: { methodology: "اقتراحات من اختيارات المحررين؛ لا تستخدم سجل اللاعبين.", provider: { configured: false, budgetCents: 0, reservedCents: 0, canGenerate: false, modelName: "not-used" },
        suggestions: [
          { ...common, categoryName: "تجربة الحروف", difficulty: "medium", format: "word", region: "qa" },
          { ...common, categoryName: "تجربة الصور", difficulty: "hard", format: "image", region: "sa" },
        ],
      },
    }));
    await page.goto("/#/admin"); await page.reload();
    await expect(page.getByRole("heading", { name: "غرفة التحرير", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "اقتراحات الأسئلة", exact: true }).click();
    await expect(page.getByText("الإضافة اليدوية والمولّد الحسابي متاحان الآن.", { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const word = page.locator(".editorial-suggestion-card").filter({ has: page.getByRole("heading", { name: "تجربة الحروف" }) });
    await word.getByRole("button", { name: "أضف سؤالًا نصيًا في هذه الفئة والمستوى", exact: true }).click();
    const composer = page.locator(".question-composer");
    await expect(composer.getByRole("button", { name: "نص سؤال مكتوب وإجابة واضحة", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(composer.getByRole("combobox", { name: "فئة السؤال", exact: true })).toHaveValue("logic");
    await expect(composer.getByRole("combobox", { name: "مستوى الصعوبة", exact: true })).toHaveValue("medium");
    await expect(composer.getByRole("combobox", { name: "المنطقة المرتبطة بالسؤال", exact: true })).toHaveValue("qa");
    await page.getByRole("button", { name: "اقتراحات الأسئلة", exact: true }).click();
    const image = page.locator(".editorial-suggestion-card").filter({ has: page.getByRole("heading", { name: "تجربة الصور" }) });
    await image.getByRole("button", { name: "أضف سؤالًا بهذه المواصفات", exact: true }).click();
    await expect(composer.getByRole("button", { name: "صورة صورة تساعد على حل السؤال", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(composer.getByRole("combobox", { name: "مستوى الصعوبة", exact: true })).toHaveValue("hard");
    await expect(composer.getByRole("combobox", { name: "المنطقة المرتبطة بالسؤال", exact: true })).toHaveValue("sa");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate(node => node.clientWidth));
  } finally {
    const profile = (await db.query("DELETE FROM users WHERE username=$1 RETURNING profile_id", [username])).rows[0]?.profile_id;
    if (profile) await db.query("DELETE FROM profiles WHERE id=$1", [profile]);
    await db.end();
  }
});
