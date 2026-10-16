import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";

const headers = { "Content-Type": "application/json", "X-Nabeeh-Request": "1" };
async function editor(page: Page) {
  const connection =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh_e2e";
  if (!new URL(connection).pathname.endsWith("_e2e"))
    throw new Error(
      "Composer browser tests require the isolated _e2e database.",
    );
  const db = new pg.Client({ connectionString: connection });
  await db.connect();
  const username = `composer_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  try {
    const initialCategories = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/categories" &&
        response.request().method() === "GET",
    );
    await page.goto("/");
    // Wait until the initial /me response has installed its guest cookie before changing it.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Home starts its category request after /me; its guest cookie must settle too.
    const categoriesResponse = await initialCategories;
    expect(categoriesResponse.ok()).toBe(true);
    await categoriesResponse.finished();
    const response = await page.request.post("/api/auth/register", {
      headers,
      data: { username, password: `Composer test ${randomUUID()}` },
    });
    expect(response.ok()).toBe(true);
    const registered = await (await page.request.get("/api/me")).json();
    expect(registered.username).toBe(username);
    await db.query("UPDATE users SET role='admin' WHERE username=$1", [
      username,
    ]);
    const promoted = await (await page.request.get("/api/me")).json();
    expect(promoted).toMatchObject({
      username,
      role: "admin",
      profileId: registered.profileId,
    });
    await page.goto("/#/admin");
    // The API fixture changed the session and role outside React. Reload to refresh /me.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "غرفة التحرير", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "إضافة سؤال", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "أضف سؤالًا بطريقتك" }),
    ).toBeVisible();
    return { db, username };
  } catch (error) {
    await cleanup(db, username, []);
    throw error;
  }
}
async function fillOriginal(page: Page, text: string) {
  const composer = page.locator(".question-composer");
  await composer
    .getByRole("textbox", { name: "نص السؤال", exact: true })
    .fill(text);
  await composer
    .getByRole("textbox", { name: "الإجابة الصحيحة", exact: true })
    .fill("45");
  await composer
    .getByRole("textbox", { name: "تلميح مساعد", exact: true })
    .fill("اجمع العشرات ثم الآحاد.");
  await composer
    .getByRole("textbox", { name: "شرح الإجابة", exact: true })
    .fill("نجمع 19 و26 لنحصل على 45.");
  await composer
    .getByRole("combobox", { name: "فئة السؤال", exact: true })
    .selectOption("logic");
  await composer
    .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
    .selectOption("medium");
  await composer
    .getByRole("radio", { name: "لغز أو محتوى أصلي", exact: true })
    .check();
  await composer
    .getByRole("textbox", { name: /^طريقة التحقّق أو الحلّ/ })
    .fill(`19 + 26 = 45. برهان أصلي لاختبار المحرّر ${text}`);
  await composer
    .getByRole("textbox", { name: "ملاحظة عن إعداد السؤال", exact: true })
    .fill("أعددت هذا السؤال الحسابي بنفسي وراجعت خطوات الحلّ يدويًا.");
}
async function cleanup(
  db: pg.Client,
  username: string,
  texts: string[],
  mediaIds: string[] = [],
) {
  const ids = (
    await db.query(
      "SELECT id FROM candidates WHERE payload->>'text'=ANY($1::text[])",
      [texts],
    )
  ).rows.map((row) => row.id);
  if (ids.length) {
    await db.query(
      "DELETE FROM candidate_vectors WHERE candidate_id=ANY($1::uuid[])",
      [ids],
    );
    await db.query(
      "DELETE FROM semantic_judgments WHERE candidate_id=ANY($1::uuid[])",
      [ids],
    );
    await db.query(
      "DELETE FROM duplicate_candidates WHERE candidate_id=ANY($1::uuid[])",
      [ids],
    );
    await db.query(
      "DELETE FROM review_tasks WHERE candidate_id=ANY($1::uuid[])",
      [ids],
    );
    await db.query("DELETE FROM candidates WHERE id=ANY($1::uuid[])", [ids]);
  }
  if (mediaIds.length)
    await db.query("DELETE FROM media_assets WHERE id=ANY($1::uuid[])", [
      mediaIds,
    ]);
  const profile = (
    await db.query("DELETE FROM users WHERE username=$1 RETURNING profile_id", [
      username,
    ])
  ).rows[0]?.profile_id;
  if (profile) await db.query("DELETE FROM profiles WHERE id=$1", [profile]);
  await db.end();
}

test("The guided composer requires a type and explicit category/difficulty; original evidence stays pending human review", async ({
  page,
}, testInfo) => {
  const { db, username } = await editor(page);
  const text = `كم يساوي مجموع 19 و26 في تجربة التحرير ${randomUUID()}؟`;
  const sourcedText = `ما قيمة مجموع 19 و26 في السؤال الموثّق ${randomUUID()}؟`;
  try {
    const composer = page.locator(".question-composer");
    await expect(
      composer.getByRole("textbox", { name: "نص السؤال", exact: true }),
    ).toHaveCount(0);
    await composer
      .getByRole("button", { name: "نص سؤال مكتوب وإجابة واضحة", exact: true })
      .click();
    await expect(
      composer.getByRole("combobox", { name: "فئة السؤال", exact: true }),
    ).toHaveValue("");
    await expect(
      composer.getByRole("combobox", { name: "مستوى الصعوبة", exact: true }),
    ).toHaveValue("");
    await fillOriginal(page, text);
    await page.screenshot({
      path: `test-results/composer-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM candidates WHERE payload->>'text'=$1",
              [text],
            )
          ).rows[0].count,
      )
      .toBe(1);
    const candidate = (
      await db.query(
        "SELECT status,payload FROM candidates WHERE payload->>'text'=$1",
        [text],
      )
    ).rows[0];
    expect(candidate.status).toBe("review");
    expect(candidate.payload).toMatchObject({
      format: "text",
      categoryIds: ["logic"],
      difficulty: "medium",
      evidenceKind: "original",
      deterministic: false,
      sources: [],
    });
    expect(
      (await db.query("SELECT 1 FROM questions WHERE text=$1", [text]))
        .rowCount,
    ).toBe(0);
    await page.getByRole("button", { name: "إضافة سؤال", exact: true }).click();
    await composer
      .getByRole("button", { name: "نص سؤال مكتوب وإجابة واضحة", exact: true })
      .click();
    await fillOriginal(page, sourcedText);
    await composer
      .getByRole("radio", { name: "معلومة تستند إلى مصدر", exact: true })
      .check();
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    expect(
      (
        await db.query("SELECT 1 FROM candidates WHERE payload->>'text'=$1", [
          sourcedText,
        ])
      ).rowCount,
    ).toBe(0);
    await composer
      .getByRole("textbox", { name: "رابط المصدر", exact: true })
      .fill("https://example.com/composer-browser-fixture");
    await composer
      .getByRole("textbox", {
        name: "المعلومة أو الفقرة التي تدعم الإجابة",
        exact: true,
      })
      .fill("مرجع اصطناعي للاختبار فقط: 19 + 26 = 45. لا يُنشر دون مراجعة.");
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM candidates WHERE payload->>'text'=$1",
              [sourcedText],
            )
          ).rows[0].count,
      )
      .toBe(1);
    const sourced = (
      await db.query(
        "SELECT status,payload FROM candidates WHERE payload->>'text'=$1",
        [sourcedText],
      )
    ).rows[0];
    expect(sourced.status).toBe("review");
    expect(sourced.payload.evidenceKind).toBe("factual");
    expect(sourced.payload.deterministic).toBe(false);
    expect(sourced.payload.sources[0].url).toBe(
      "https://example.com/composer-browser-fixture",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await cleanup(db, username, [text, sourcedText]);
  }
});

test("A failed submission keeps uploaded media and inputs; retry reuses the file and the private media library previews it", async ({
  page,
}, testInfo) => {
  const { db, username } = await editor(page);
  const text = `ما العدد المكتوب في الصورة الخاصة بتجربة ${randomUUID()}؟`;
  const credit = `مؤلف الاختبار ${randomUUID()}`;
  const mediaIds: string[] = [];
  let uploads = 0,
    failed = false;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/admin/media") &&
      request.method() === "POST"
    )
      uploads++;
  });
  await page.route("**/api/admin/submissions", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "تعذّر حفظ السؤال مؤقتًا. حاول مرة أخرى.",
        }),
      });
    } else await route.continue();
  });
  try {
    const composer = page.locator(".question-composer");
    await composer
      .getByRole("button", {
        name: "صورة صورة تساعد على حل السؤال",
        exact: true,
      })
      .click();
    await composer
      .getByLabel("اختر ملف الوسائط", { exact: true })
      .setInputFiles({
        name: "original.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    const accessibility = composer.locator("details").filter({
      has: page.locator("summary", { hasText: "إمكانية الوصول (اختياري)" }),
    });
    await expect(accessibility).not.toHaveAttribute("open");
    await expect(accessibility.locator("input")).not.toHaveAttribute(
      "required",
    );
    await expect(accessibility.locator("input")).toHaveValue("");
    await expect(
      composer.getByRole("textbox", { name: /^وصف إضافي لقارئ الشاشة/ }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        composer
          .locator(".qc-preview img")
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await composer
      .getByRole("textbox", {
        name: "صاحب المحتوى أو اسم الجهة المنتجة",
        exact: true,
      })
      .fill(credit);
    await composer
      .getByRole("checkbox", {
        name: "أؤكد أن لدي حق نشر هذا الملف واستخدامه في اللعبة.",
        exact: true,
      })
      .check();
    await fillOriginal(page, text);
    await page.screenshot({
      path: `test-results/composer-media-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect(composer.getByRole("alert")).toHaveText(
      "تعذّر حفظ السؤال مؤقتًا. حاول مرة أخرى.",
    );
    await expect(
      composer.getByRole("textbox", { name: "نص السؤال", exact: true }),
    ).toHaveValue(text);
    await expect(
      composer.getByText(
        "الملف محفوظ. إعادة إرسال السؤال لن ترفع الملف مرة أخرى.",
        { exact: true },
      ),
    ).toBeVisible();
    const uploaded = (
      await db.query("SELECT id,storage FROM media_assets WHERE credit=$1", [
        credit,
      ])
    ).rows[0];
    mediaIds.push(uploaded.id);
    expect(uploaded.storage).toBe("database");
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM candidates WHERE payload->>'text'=$1",
              [text],
            )
          ).rows[0].count,
      )
      .toBe(1);
    expect(uploads).toBe(1);
    const candidate = (
      await db.query(
        "SELECT payload FROM candidates WHERE payload->>'text'=$1",
        [text],
      )
    ).rows[0];
    expect(candidate.payload.media.assetId).toBe(uploaded.id);
    expect(candidate.payload.format).toBe("image");
    expect(candidate.payload.media.alt).toBe("الصورة المرفقة بالسؤال");
    expect(candidate.payload.media.alt).not.toBe(text);
    await page.getByRole("button", { name: "إضافة سؤال", exact: true }).click();
    await composer
      .getByRole("button", {
        name: "صورة صورة تساعد على حل السؤال",
        exact: true,
      })
      .click();
    await composer
      .getByRole("button", { name: "من مكتبة الوسائط", exact: true })
      .click();
    await composer
      .getByRole("combobox", { name: "الملف المحفوظ", exact: true })
      .selectOption(uploaded.id);
    const image = composer.getByRole("img", {
      name: "معاينة الصورة المرفقة بالسؤال",
      exact: true,
    });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute(
      "src",
      `/api/admin/media/${uploaded.id}`,
    );
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    expect(
      (await page.request.get(`/api/admin/media/${uploaded.id}`)).status(),
    ).toBe(200);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (!mediaIds.length)
      mediaIds.push(
        ...(
          await db.query("SELECT id FROM media_assets WHERE credit=$1", [
            credit,
          ])
        ).rows.map((row) => row.id),
      );
    await cleanup(db, username, [text], mediaIds);
  }
});

test("Audio and video drafts use one question prompt while optional accessibility fields can stay empty", async ({
  page,
}) => {
  const { db, username } = await editor(page);
  const texts: string[] = [];
  try {
    const releasePack = JSON.parse(
      await readFile("media/release-pack.json", "utf8"),
    ) as {
      questions: {
        format: string;
        text: string;
        answer: string;
        explanation: string;
        hint: string;
        categoryIds: string[];
        difficulty: string;
        media?: { assetId: string };
      }[];
    };
    for (const format of ["audio", "video"] as const) {
      const fixture = releasePack.questions.find(
        (question) => question.format === format,
      )!;
      expect(fixture?.media?.assetId).toBeTruthy();
      expect(fixture.categoryIds.length).toBeGreaterThan(0);
      const text = `${fixture.text} — اختبار المحرّر ${randomUUID()}`;
      texts.push(text);
      const composer = page.locator(".question-composer");
      await page
        .getByRole("button", { name: "إضافة سؤال", exact: true })
        .click();
      await composer
        .getByRole("button", {
          name:
            format === "audio"
              ? "صوت مقطع يستمع إليه اللاعب"
              : "فيديو مقطع يشاهده اللاعب",
          exact: true,
        })
        .click();
      await composer
        .getByRole("button", { name: "من مكتبة الوسائط", exact: true })
        .click();
      await composer
        .getByRole("combobox", { name: "الملف المحفوظ", exact: true })
        .selectOption(fixture.media!.assetId);
      const accessibility = composer.locator("details").filter({
        has: page.locator("summary", { hasText: "إمكانية الوصول (اختياري)" }),
      });
      await expect(accessibility).not.toHaveAttribute("open");
      await expect(accessibility.locator("input")).not.toHaveAttribute(
        "required",
      );
      await expect(accessibility.locator("textarea")).not.toHaveAttribute(
        "required",
      );
      await expect(accessibility.locator("input")).toHaveValue("");
      await expect(accessibility.locator("textarea")).toHaveValue("");
      await expect(
        composer.getByRole("textbox", { name: "نص السؤال", exact: true }),
      ).toHaveCount(1);
      await expect(
        composer.getByRole("textbox", { name: /^وصف إضافي لقارئ الشاشة/ }),
      ).toHaveCount(0);
      await expect(
        composer.getByRole("textbox", { name: /^تفريغ المقطع أو وصف محتواه/ }),
      ).toHaveCount(0);
      await fillOriginal(page, text);
      await composer
        .getByRole("textbox", { name: "الإجابة الصحيحة", exact: true })
        .fill(fixture.answer);
      await composer
        .getByRole("textbox", { name: "شرح الإجابة", exact: true })
        .fill(fixture.explanation);
      await composer
        .getByRole("textbox", { name: "تلميح مساعد", exact: true })
        .fill(fixture.hint);
      await composer
        .getByRole("combobox", { name: "فئة السؤال", exact: true })
        .selectOption(fixture.categoryIds[0]);
      await composer
        .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
        .selectOption(fixture.difficulty);
      await composer
        .getByRole("textbox", { name: /^طريقة التحقّق أو الحلّ/ })
        .fill(
          `راجعت المقطع الأصلي وعددت الأحداث يدويًا: ${fixture.explanation} مرجع اختبار ${text}`,
        );
      await composer
        .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT count(*)::int AS count FROM candidates WHERE payload->>'text'=$1",
                [text],
              )
            ).rows[0].count,
        )
        .toBe(1);
      const candidate = (
        await db.query(
          "SELECT status,payload FROM candidates WHERE payload->>'text'=$1",
          [text],
        )
      ).rows[0];
      expect(candidate.status).toBe("review");
      expect(candidate.payload.media.assetId).toBe(fixture.media!.assetId);
      expect(candidate.payload.media.alt).toBe(
        format === "audio"
          ? "المقطع الصوتي المرفق بالسؤال"
          : "الفيديو المرفق بالسؤال",
      );
      expect(candidate.payload.media.alt).not.toBe(text);
      expect(candidate.payload.media.transcript || "").toBe("");
      expect(candidate.payload.deterministic).toBe(false);
      expect(
        (await db.query("SELECT 1 FROM questions WHERE text=$1", [text]))
          .rowCount,
      ).toBe(0);
    }
  } finally {
    await cleanup(db, username, texts);
  }
});
