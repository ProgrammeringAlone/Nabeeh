import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "../../server/auth.ts";
test("Unauthorized admin access is blocked; editors review and publish persistent content", async ({
  page,
}) => {
  await page.goto("/#/account");
  await expect(
    page.getByRole("heading", { name: "خلّ كل سؤال جديد" }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/overview")).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/games", {
        headers: {
          "Content-Type": "application/json",
          "X-Nabeeh-Request": "1",
        },
        data: "{invalid",
      })
    ).status(),
  ).toBe(400);
  expect((await page.request.post("/api/games", { data: {} })).status()).toBe(
    403,
  );
  const username = ("editor_" + randomUUID().replaceAll("-", "")).slice(0, 30),
    password = "editor test password " + randomUUID();
  await page
    .getByRole("textbox", { name: "اسم المستخدم", exact: false })
    .fill(username);
  await page.getByLabel("كلمة المرور", { exact: false }).fill(password);
  await page.getByRole("button", { name: "أنشئ حسابي" }).click();
  await expect(page.getByRole("heading", { name: /أهلًا/ })).toBeVisible();
  const db = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh",
  });
  await db.connect();
  await db.query("UPDATE users SET role='editor' WHERE username=$1", [
    username,
  ]);
  expect((await page.request.get("/api/admin/access")).status()).toBe(403);
  await page.goto("/#/admin");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "غرفة التحرير" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "التوليد والاستيراد", exact: true })
    .click();
  const a = 10000 + Math.floor(Math.random() * 50000),
    answer = String(a * 17),
    factKey = `test-editor:${a}:17:${randomUUID()}`;
  const candidate = {
    text: `كم يساوي حاصل ${a} ضرب 17؟`,
    answer,
    explanation: `${a} × 17 = ${answer}.`,
    hint: "اضرب في عشرة ثم في سبعة واجمع الناتجين.",
    factKey,
    subject: `${a},17`,
    predicate: "multiply",
    fact: `${a}*17=${answer}`,
    categoryIds: ["logic"],
    difficulty: "hard",
    deterministic: true,
    provenance: "Original browser editorial test fixture",
  };
  await page
    .getByLabel("JSON", { exact: true })
    .fill(JSON.stringify(candidate));
  await page.getByRole("button", { name: "إرسال للمراجعة" }).click();
  await expect(page.getByLabel("JSON", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "مراجعة المحتوى", exact: true })
    .click();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: candidate.text }) });
  await expect(card).toBeVisible();
  expect(
    (await db.query("SELECT 1 FROM questions WHERE fact_key=$1", [factKey]))
      .rowCount,
  ).toBe(0);
  await card
    .getByRole("button", { name: "تعديل المسودة", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "التلميح", exact: true })
    .fill("قسّم حاصل الضرب إلى خطوات صغيرة.");
  await page
    .getByLabel("سبب تعديل المسودة", { exact: true })
    .fill("راجعت صياغة التلميح وجعلت خطوات حل السؤال أكثر وضوحًا.");
  await page.getByRole("button", { name: "حفظ المسودة", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "تعديل المسودة قبل الاعتماد",
      exact: true,
    }),
  ).toHaveCount(0);
  await card
    .getByLabel("ملاحظات المراجعة لهذا السؤال", { exact: true })
    .fill(
      `Verified calculation: ${a} * 17 = ${answer}. Original independent fact reviewed.`,
    );
  const duplicateCheck = card.getByRole("checkbox", {
    name: /راجعت الأسئلة المشابهة/,
  });
  if (await duplicateCheck.count()) await duplicateCheck.check();
  await card.getByRole("button", { name: "اعتماد السؤال", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: /^المعتمدة/ }).click();
  await expect(card.getByText("معتمد", { exact: true })).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT 1 FROM questions WHERE fact_key=$1 AND status='approved'",
        [factKey],
      )
    ).rowCount,
  ).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const {
    rows: [q],
  } = await db.query("SELECT id FROM questions WHERE fact_key=$1", [factKey]);
  await page.getByRole("button", { name: "المكتبة", exact: true }).click();
  await page.getByLabel("بيانات التحقّق", { exact: true }).fill(
    JSON.stringify({
      id: q.id,
      sources: [],
      note: "Verified exact arithmetic for release; canonical identity is retained.",
      verifiedFact: candidate.fact,
    }),
  );
  await page
    .getByRole("button", { name: "اعتماد مصادر الإطلاق", exact: true })
    .click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(page.getByLabel("بيانات التحقّق", { exact: true })).toHaveValue(
    "",
  );
  await db.query("UPDATE users SET role='admin' WHERE username=$1", [username]);
  const targetProfile = randomUUID(),
    targetId = randomUUID(),
    targetUsername = ("target_" + randomUUID().replaceAll("-", "")).slice(
      0,
      30,
    );
  await db.query("INSERT INTO profiles(id,kind) VALUES($1,'account')", [
    targetProfile,
  ]);
  await db.query(
    "INSERT INTO users(id,profile_id,username,password_hash) VALUES($1,$2,$3,$4)",
    [
      targetId,
      targetProfile,
      targetUsername,
      hashPassword("temporary fixture " + randomUUID()),
    ],
  );
  await page.reload();
  await page
    .getByRole("button", { name: "صلاحيات المستخدمين", exact: true })
    .click();
  const member = page
    .locator(".report-row")
    .filter({ has: page.getByText(targetUsername, { exact: true }) });
  await member.getByRole("button", { name: "محرّر", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(
    member.locator("p").filter({hasText:/^محرّر$/}),
  ).toBeVisible();
  await db.query("DELETE FROM users WHERE id=$1", [targetId]);
  await db.query("DELETE FROM profiles WHERE id=$1", [targetProfile]);
  await db.query("DELETE FROM accepted_answers WHERE question_id=$1", [q.id]);
  await db.query("DELETE FROM evidence WHERE question_id=$1", [q.id]);
  await db.query("DELETE FROM question_categories WHERE question_id=$1", [
    q.id,
  ]);
  await db.query(
    "DELETE FROM duplicate_candidates WHERE question_id=$1 OR candidate_id=$1",
    [q.id],
  );
  await db.query("DELETE FROM review_tasks WHERE candidate_id=$1", [q.id]);
  await db.query("DELETE FROM questions WHERE id=$1", [q.id]);
  await db.query("DELETE FROM candidates WHERE id=$1", [q.id]);
  expect(
    (
      await page.request.delete("/api/account", {
        headers: { "X-Nabeeh-Request": "1" },
        data: { confirm: "DELETE", password },
      })
    ).status(),
  ).toBe(200);
  await db.end();
});
