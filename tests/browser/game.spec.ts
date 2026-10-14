import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("Arabic RTL, full game, reveal boundary, reload, scoring and summary", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /اللّمّة تحلى/ }),
  ).toBeVisible();
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  await page.getByRole("button", { name: "ابدأ التحدّي" }).click();
  await expect(
    page.getByRole("heading", { name: "نرتّب اللمّة؟" }),
  ).toBeVisible();
  // Choose only one category; every fresh browser has an independent persistent guest profile.
  await page
    .getByRole("button", { name: /السعودية والخليج.*سؤال جديد/ })
    .click();
  await page.getByRole("button", { name: /علوم وطبيعة.*سؤال جديد/ }).click();
  await page.getByRole("button", { name: "ابدأ اللعبة" }).click();
  await expect(page.getByRole("heading", { name: /يا الصقور/ })).toBeVisible();
  const gameUrl = page.url();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", { name: /ألغاز ومنطق \d+ نقطة$/ })
      .first()
      .click();
    await expect(page.getByTestId("question-text")).toBeVisible();
    await expect(page.getByTestId("answer-text")).toHaveCount(0);
    if (i === 0) {
      await page
        .getByRole("button", { name: "خيط الحلّ", exact: true })
        .click();
      await page.reload();
      await expect(page.getByTestId("question-text")).toBeVisible();
    }
    await page.getByRole("button", { name: "اكشف الإجابة" }).click();
    await expect(page.getByTestId("answer-text")).toBeVisible();
    await page.getByRole("button", { name: /^صحيح — / }).click();
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    if (i < 2)
      await expect(
        page.getByRole("heading", { name: /اختاروا تحدّيكم/ }),
      ).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /مبروك يا/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /مبروك يا/ })).toBeVisible();
  expect(page.url()).toBe(gameUrl);
  await page.screenshot({
    path: `test-results/game-${test.info().project.name}.png`,
    fullPage: true,
  });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
test("Homepage, library filters/favorites and account are accessible and fit viewport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /اللّمّة تحلى/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/#/categories");
  await expect(
    page.getByRole("heading", { name: "اكتشف الفئات" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "ابحث عن فئة" }).fill("علوم");
  await expect(
    page.getByRole("heading", { name: "علوم وطبيعة" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إضافة علوم وطبيعة للمفضلة" }).click();
  await expect(
    page.getByRole("button", { name: "إزالة علوم وطبيعة من المفضلة" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "المفضّلة", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "علوم وطبيعة" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("Account identity works on a second browser and logout does not lose account data", async ({
  page,
  browser,
}) => {
  await page.goto("/#/account");
  await expect(
    page.getByRole("heading", { name: "خلّ كل سؤال جديد" }),
  ).toBeVisible();
  const username = "player_" + Date.now() + "_" + test.info().project.name;
  await page
    .getByRole("textbox", { name: "اسم المستخدم", exact: false })
    .fill(username.slice(0, 30));
  await page
    .getByLabel("كلمة المرور", { exact: false })
    .fill("secure browser password");
  await page.getByRole("button", { name: "أنشئ حسابي" }).click();
  await expect(page.getByRole("heading", { name: /أهلًا/ })).toBeVisible();
  const create = await page.request.post("/api/games", {
    headers: { "X-Nabeeh-Request": "1" },
    data: {
      categoryIds: ["science"],
      teamNames: ["ألف", "باء"],
      timer: 180,
      questionsPerCategory: 3,
    },
  });
  expect(create.status()).toBe(201);
  const { id } = await create.json();
  const state = await (await page.request.get("/api/games/" + id)).json();
  await page.request.post("/api/games/" + id + "/open", {
    headers: { "X-Nabeeh-Request": "1" },
    data: { instanceId: state.tiles[0].id },
  });
  const ctx = await browser.newContext(),
    other = await ctx.newPage();
  await other.goto("/#/account");
  await other
    .getByRole("button", { name: "تسجيل الدخول", exact: true })
    .click();
  await other
    .getByRole("textbox", { name: "اسم المستخدم", exact: false })
    .fill(username.slice(0, 30));
  await other
    .getByLabel("كلمة المرور", { exact: false })
    .fill("secure browser password");
  await other.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(other.getByRole("heading", { name: /أهلًا/ })).toBeVisible();
  expect((await (await other.request.get("/api/me")).json()).seen).toBe(1);
  const resumed = await (await other.request.get("/api/games/" + id)).json();
  expect(resumed.status).toBe("active");
  expect(resumed.current.id).toBe(state.tiles[0].id);
  await other
    .getByRole("button", { name: "تسجيل الخروج", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "خلّ كل سؤال جديد" }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).seen).toBe(1);
  await ctx.close();
});
