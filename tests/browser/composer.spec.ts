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
async function fillQuestion(page: Page, text: string) {
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
    .fill(`نجمع 19 و26 لنحصل على 45. ${text}`);
  await composer
    .getByRole("combobox", { name: "فئة السؤال", exact: true })
    .selectOption("logic");
  await composer
    .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
    .selectOption("medium");
}
function captureUploads(page: Page) {
  const pending: Promise<void>[] = [];
  const mediaIds: string[] = [];
  const requests: Record<string, string>[] = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/admin/media" &&
      response.request().method() === "POST" &&
      response.ok()
    ) {
      requests.push(response.request().headers());
      pending.push(
        response.json().then((asset) => {
          mediaIds.push(asset.id);
        }),
      );
    }
  });
  return {
    mediaIds,
    requests,
    settle: async () => {
      await Promise.all(pending);
    },
  };
}
async function expectSimpleComposer(page: Page) {
  const composer = page.locator(".question-composer");
  await expect(composer.locator(".qc-origin")).toContainText("Admin");
  await expect(
    composer.getByLabel(
      /رابط المصدر|المعلومة أو الفقرة|طريقة التحقّق|ملاحظة عن إعداد السؤال|صاحب المحتوى|صاحب صورة الإجابة|الترخيص|إذن الاستخدام|حق نشر/,
    ),
  ).toHaveCount(0);
  await expect(
    composer.getByRole("radio", { name: /أصلي|تستند إلى مصدر/ }),
  ).toHaveCount(0);
}
async function expectAdminOrigin(
  db: pg.Client,
  text: string,
  username: string,
) {
  const row = (
    await db.query(
      "SELECT c.creation_kind,u.username FROM candidates c LEFT JOIN users u ON u.id=c.created_by WHERE c.payload->>'text'=$1",
      [text],
    )
  ).rows[0];
  expect(row).toEqual({ creation_kind: "admin", username });
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

test("Question and answer images upload independently, survive a failed save, and preview separately in review", async ({
  page,
}, testInfo) => {
  const { db, username } = await editor(page);
  const text = `أي صورة تكمل النمط في سؤال الاختبار ${randomUUID()}؟`;
  const upload = captureUploads(page);
  const { mediaIds } = upload;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
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
        name: "question.png",
        mimeType: "image/png",
        buffer: png,
      });
    await fillQuestion(page, text);
    await composer
      .getByRole("group", { name: "نوع الإجابة", exact: true })
      .getByRole("button", { name: "صورة", exact: true })
      .click();
    const picker = composer.getByTestId("answer-image-picker");
    await picker
      .getByLabel("اختر صورة الإجابة", { exact: true })
      .setInputFiles({
        name: "answer.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("invalid image"),
      });
    await expect(composer.getByRole("alert")).toHaveText(
      "اختر صورة إجابة بصيغة PNG أو JPG أو WebP.",
    );
    await picker
      .getByLabel("اختر صورة الإجابة", { exact: true })
      .setInputFiles({
        name: "answer.png",
        mimeType: "image/png",
        buffer: png,
      });
    await expect
      .poll(() =>
        picker
          .getByTestId("answer-image-preview")
          .locator("img")
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBe(1);
    await expectSimpleComposer(page);
    await expect(
      composer.getByRole("textbox", { name: "نص السؤال", exact: true }),
    ).toHaveCount(1);
    await page.screenshot({
      path: `test-results/answer-image-composer-${testInfo.project.name}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect(composer.getByRole("alert")).toHaveText(
      "تعذّر حفظ السؤال مؤقتًا. حاول مرة أخرى.",
    );
    await upload.settle();
    const assets = (
      await db.query(
        "SELECT id,credit,license,source FROM media_assets WHERE id=ANY($1::uuid[])",
        [mediaIds],
      )
    ).rows;
    expect(
      assets.every(
        (asset) =>
          asset.credit === null &&
          asset.license === null &&
          asset.source === null,
      ),
    ).toBe(true);
    for (const request of upload.requests) {
      expect(request["x-media-credit"]).toBeUndefined();
      expect(request["x-media-license"]).toBeUndefined();
      expect(request["x-media-source"]).toBeUndefined();
    }
    expect(mediaIds).toHaveLength(2);
    expect(uploads).toBe(2);
    await expect(picker.getByText(/صورة الإجابة محفوظة/)).toBeVisible();
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS n FROM candidates WHERE payload->>'text'=$1",
              [text],
            )
          ).rows[0].n,
      )
      .toBe(1);
    expect(uploads).toBe(2);
    const candidate = (
      await db.query(
        "SELECT status,payload FROM candidates WHERE payload->>'text'=$1",
        [text],
      )
    ).rows[0];
    const [questionId, answerId] = mediaIds;
    await expectAdminOrigin(db, text, username);
    expect(candidate.status).toBe("review");
    expect(candidate.payload.media.assetId).toBe(questionId);
    expect(candidate.payload.answerMedia).toEqual({
      assetId: answerId,
      alt: "صورة الإجابة الصحيحة",
    });
    expect(answerId).not.toBe(questionId);
    expect(
      (await db.query("SELECT 1 FROM questions WHERE text=$1", [text]))
        .rowCount,
    ).toBe(0);
    await page
      .getByRole("button", { name: "مراجعة المحتوى", exact: true })
      .click();
    const card = page
      .locator(".rq-card")
      .filter({ has: page.getByRole("heading", { name: text, exact: true }) });
    await expect(card.getByTestId("question-origin")).toContainText(
      "Admin · مشرف",
    );
    await expect(card.getByTestId("question-origin")).toContainText(username);
    await expect(card.getByTestId("review-answer-image")).toHaveAttribute(
      "src",
      `/api/admin/media/${answerId}`,
    );
    await expect
      .poll(() =>
        card
          .getByTestId("review-answer-image")
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBe(1);
    await expect(
      card.locator(".rq-media").first().locator("img"),
    ).toHaveAttribute("src", `/api/admin/media/${questionId}`);
    await expect(
      card.getByText("المرجع النصي للإجابة", { exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The same answer asset can be reused without uploading a third file.
    await page.getByRole("button", { name: "إضافة سؤال", exact: true }).click();
    await composer
      .getByRole("button", { name: "نص سؤال مكتوب وإجابة واضحة", exact: true })
      .click();
    await composer
      .getByRole("group", { name: "نوع الإجابة", exact: true })
      .getByRole("button", { name: "صورة", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "صورة من المكتبة", exact: true })
      .click();
    await picker
      .getByRole("combobox", { name: "صورة الإجابة المحفوظة", exact: true })
      .selectOption(answerId);
    await expect(
      picker.getByTestId("answer-image-preview").locator("img"),
    ).toHaveAttribute("src", `/api/admin/media/${answerId}`);
    expect(uploads).toBe(2);
    await picker
      .getByRole("button", { name: "إزالة صورة الإجابة", exact: true })
      .click();
    await expect(picker.getByTestId("answer-image-preview")).toHaveCount(0);
  } finally {
    await upload.settle();
    await cleanup(db, username, [text], mediaIds);
  }
});

test("The guided composer saves admin questions with category and difficulty and no references or copyright fields", async ({
  page,
}, testInfo) => {
  const { db, username } = await editor(page);
  const text = `كم يساوي مجموع 19 و26 في تجربة التحرير ${randomUUID()}؟`;
  try {
    const composer = page.locator(".question-composer");
    await expect(
      composer.getByRole("textbox", { name: "نص السؤال", exact: true }),
    ).toHaveCount(0);
    await composer
      .getByRole("button", { name: "نص سؤال مكتوب وإجابة واضحة", exact: true })
      .click();
    await expectSimpleComposer(page);
    await expect(
      composer.getByRole("combobox", { name: "فئة السؤال", exact: true }),
    ).toHaveValue("");
    await expect(
      composer.getByRole("combobox", { name: "مستوى الصعوبة", exact: true }),
    ).toHaveValue("");
    await fillQuestion(page, text);
    await page.screenshot({
      path: `test-results/composer-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const submitted = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/admin/submissions" &&
        request.method() === "POST",
    );
    await composer
      .getByRole("button", { name: "إرسال السؤال للمراجعة", exact: true })
      .click();
    const body = (await submitted).postDataJSON();
    for (const key of [
      "sources",
      "evidenceKind",
      "proof",
      "provenance",
      "creationKind",
      "createdBy",
      "creation_kind",
      "created_by",
    ])
      expect(body).not.toHaveProperty(key);
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
      deterministic: false,
      sources: [],
    });
    await expectAdminOrigin(db, text, username);
    expect(
      (await db.query("SELECT 1 FROM questions WHERE text=$1", [text]))
        .rowCount,
    ).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await cleanup(db, username, [text]);
  }
});

test("A failed submission keeps uploaded media and inputs; retry reuses the file and the private media library previews it", async ({
  page,
}, testInfo) => {
  const { db, username } = await editor(page);
  const text = `ما العدد المكتوب في الصورة الخاصة بتجربة ${randomUUID()}؟`;
  const upload = captureUploads(page);
  const { mediaIds } = upload;
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
    await expectSimpleComposer(page);
    await fillQuestion(page, text);
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
    await upload.settle();
    expect(mediaIds).toHaveLength(1);
    const uploaded = (
      await db.query(
        "SELECT id,storage,credit,license,source FROM media_assets WHERE id=$1",
        [mediaIds[0]],
      )
    ).rows[0];
    expect(uploaded).toMatchObject({
      credit: null,
      license: null,
      source: null,
    });
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
    await upload.settle();
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
      await fillQuestion(page, text);
      await composer
        .getByRole("textbox", { name: "الإجابة الصحيحة", exact: true })
        .fill(fixture.answer);
      await composer
        .getByRole("textbox", { name: "شرح الإجابة", exact: true })
        .fill(`${fixture.explanation} ${text}`);
      await composer
        .getByRole("textbox", { name: "تلميح مساعد", exact: true })
        .fill(fixture.hint);
      await composer
        .getByRole("combobox", { name: "فئة السؤال", exact: true })
        .selectOption(fixture.categoryIds[0]);
      await composer
        .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
        .selectOption(fixture.difficulty);
      await expectSimpleComposer(page);
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
      await expectAdminOrigin(db, text, username);
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
