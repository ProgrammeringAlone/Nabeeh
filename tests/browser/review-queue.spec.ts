import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";

const headers = { "Content-Type": "application/json", "X-Nabeeh-Request": "1" };
type Fixture = {
  db: pg.Client;
  username: string;
  sourceCategory: string;
  targetCategory: string;
  candidateIds: string[];
};

async function administrator(page: Page): Promise<Fixture> {
  const connection = process.env.DATABASE_URL;
  if (!connection || !new URL(connection).pathname.endsWith("_e2e")) {
    throw new Error(
      "Review queue browser tests require the isolated _e2e database.",
    );
  }
  const db = new pg.Client({ connectionString: connection });
  await db.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const username = `review_${suffix}`;
  await page.goto("/#/account");
  // Finish the initial guest session response before registering an account.
  // Otherwise its late Set-Cookie can replace the account session cookie.
  await expect(
    page.getByRole("heading", { name: "خلّ كل سؤال جديد", exact: true }),
  ).toBeVisible();
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: { username, password: `Review queue password ${randomUUID()}` },
  });
  expect(registration.status()).toBe(200);
  await db.query("UPDATE users SET role='admin' WHERE username=$1", [username]);
  const identity = await page.request.get("/api/me");
  expect(identity.status()).toBe(200);
  expect(await identity.json()).toMatchObject({
    username,
    role: "admin",
    userId: expect.any(String),
  });
  const sourceCategory = `review_source_${suffix}`;
  const targetCategory = `review_target_${suffix}`;
  for (const [id, name] of [
    [sourceCategory, `فئة السؤال الأصلية ${suffix}`],
    [targetCategory, `الفئة التي اختارها المدير ${suffix}`],
  ]) {
    await db.query(
      "INSERT INTO categories(id,name,description,icon,color) VALUES($1,$2,'فئة مستقلة لاختبار المراجعة','◇','#edf1e5')",
      [id, name],
    );
  }
  return { db, username, sourceCategory, targetCategory, candidateIds: [] };
}

function arithmetic(categoryId: string) {
  const a = 1_000_000 + Math.floor(Math.random() * 100_000_000);
  const b = 37;
  const answer = String(a + b);
  return {
    text: `كم يساوي مجموع ${a} و${b}؟`,
    answer,
    explanation: `نجمع العددين: ${a} + ${b} = ${answer}.`,
    hint: "ابدأ بجمع العشرات، ثم أضف الآحاد.",
    factKey: `browser-review:${randomUUID()}`,
    subject: `${a},${b}`,
    predicate: "add",
    fact: `${a}+${b}=${answer}`,
    categoryIds: [categoryId],
    difficulty: "easy",
    format: "text",
    deterministic: true,
    provenance: "حساب أصلي في اختبار مستقل لمسار المراجعة.",
  };
}

async function addCandidate(
  page: Page,
  fixture: Fixture,
  payload: ReturnType<typeof arithmetic>,
) {
  const response = await page.request.post("/api/admin/candidates", {
    headers,
    data: payload,
  });
  expect(response.status()).toBe(201);
  const candidate = await response.json();
  fixture.candidateIds.push(candidate.id);
  return candidate as { id: string; status: string };
}

async function openQueue(page: Page, fixture: Fixture) {
  await page.goto("/#/admin");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "غرفة التحرير", exact: true }),
  ).toBeVisible();
  const queue = page.locator(".rq");
  await expect(
    queue.getByRole("heading", { name: "مراجعة الأسئلة", exact: true }),
  ).toBeVisible();
  await expect(
    queue.getByRole("combobox", { name: "تصفية حسب الفئة", exact: true }),
  ).toBeEnabled();
  await queue
    .getByRole("combobox", { name: "تصفية حسب الفئة", exact: true })
    .selectOption(fixture.sourceCategory);
  return queue;
}

function questionCard(queue: Locator, text: string) {
  return queue.locator(".rq-card").filter({ hasText: text });
}

async function checkSimilarQuestions(card: Locator) {
  const checkbox = card.getByRole("checkbox", {
    name: "راجعت الأسئلة المشابهة، وتحقّقت أن هذا السؤال لا يكرّر سؤالًا آخر.",
    exact: true,
  });
  if (await checkbox.count()) await checkbox.check();
}

async function approve(page: Page, card: Locator, candidateId: string) {
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/api/admin/candidates/${candidateId}/review`) &&
      result.request().method() === "POST",
  );
  await card
    .getByRole("button", { name: "اعتماد السؤال", exact: true })
    .click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  return response;
}

async function cleanup(fixture: Fixture) {
  const { db, candidateIds, username, sourceCategory, targetCategory } =
    fixture;
  try {
    if (candidateIds.length) {
      for (const sql of [
        "DELETE FROM semantic_judgments WHERE candidate_id=ANY($1::uuid[]) OR question_id=ANY($1::uuid[])",
        "DELETE FROM candidate_vectors WHERE candidate_id=ANY($1::uuid[])",
        "DELETE FROM semantic_vectors WHERE question_id=ANY($1::uuid[])",
        "DELETE FROM duplicate_candidates WHERE candidate_id=ANY($1::uuid[]) OR question_id=ANY($1::uuid[])",
        "DELETE FROM review_tasks WHERE candidate_id=ANY($1::uuid[])",
        "DELETE FROM accepted_answers WHERE question_id=ANY($1::uuid[])",
        "DELETE FROM evidence WHERE question_id=ANY($1::uuid[])",
        "DELETE FROM question_categories WHERE question_id=ANY($1::uuid[])",
        "DELETE FROM question_variants WHERE question_id=ANY($1::uuid[])",
        "DELETE FROM questions WHERE id=ANY($1::uuid[])",
        "DELETE FROM candidates WHERE id=ANY($1::uuid[])",
        "DELETE FROM audit_logs WHERE target=ANY($1::text[])",
      ])
        await db.query(sql, [candidateIds]);
    }
    await db.query("DELETE FROM categories WHERE id=ANY($1::text[])", [
      [sourceCategory, targetCategory],
    ]);
    const profile = (
      await db.query(
        "DELETE FROM users WHERE username=$1 RETURNING profile_id",
        [username],
      )
    ).rows[0]?.profile_id;
    if (profile) await db.query("DELETE FROM profiles WHERE id=$1", [profile]);
  } finally {
    await db.end();
  }
}

test("An administrator classifies questions before deciding; decisions leave the waiting list and retain independent notes", async ({
  page,
}) => {
  const fixture = await administrator(page);
  try {
    const accepted = {
      ...arithmetic(fixture.sourceCategory),
      deterministic: false,
      evidenceKind: "original",
    };
    const rejected = arithmetic(fixture.sourceCategory);
    const acceptedCandidate = await addCandidate(page, fixture, accepted);
    const rejectedCandidate = await addCandidate(page, fixture, rejected);
    expect([acceptedCandidate.status, rejectedCandidate.status]).toEqual([
      "review",
      "review",
    ]);
    const queue = await openQueue(page, fixture);
    const first = questionCard(queue, accepted.text);
    const second = questionCard(queue, rejected.text);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await first.getByText("المصادر وطريقة التحقّق", { exact: true }).click();
    await expect(
      first.getByText(`طريقة التحقّق من المحتوى الأصلي: ${accepted.fact}`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      first.getByRole("button", { name: "اعتماد السؤال", exact: true }),
    ).toBeDisabled();
    await first
      .getByRole("combobox", { name: "الفئة الأساسية", exact: true })
      .selectOption(fixture.targetCategory);
    await first
      .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
      .selectOption("hard");
    const verification = `راجعت الجمع يدويًا: ${accepted.fact}. اخترت الفئة والمستوى بعد مراجعة الحلّ.`;
    await first
      .getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      })
      .fill(verification);
    await checkSimilarQuestions(first);
    await expect(
      second.getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      }),
    ).toHaveValue("");
    await expect(
      second.getByRole("button", { name: "اعتماد السؤال", exact: true }),
    ).toBeDisabled();
    await expect(
      second.getByRole("button", { name: "رفض السؤال", exact: true }),
    ).toBeDisabled();
    expect(
      (await new AxeBuilder({ page }).include(".rq").analyze()).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    expect((await approve(page, first, acceptedCandidate.id)).status()).toBe(
      200,
    );
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    const stored = (
      await fixture.db.query(
        "SELECT c.status,c.payload,c.verification_note,c.revision,q.difficulty FROM candidates c JOIN questions q ON q.id=c.id WHERE c.id=$1",
        [acceptedCandidate.id],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      status: "approved",
      difficulty: "hard",
      revision: 2,
      verification_note: verification,
      payload: { categoryIds: [fixture.targetCategory], difficulty: "hard" },
    });
    expect(
      (
        await fixture.db.query(
          "SELECT citation,verification_method FROM evidence WHERE question_id=$1",
          [acceptedCandidate.id],
        )
      ).rows,
    ).toEqual([
      { citation: accepted.fact, verification_method: "editorial-original" },
    ]);
    expect(
      (
        await fixture.db.query(
          "SELECT category_id FROM question_categories WHERE question_id=$1",
          [acceptedCandidate.id],
        )
      ).rows.map((row) => row.category_id),
    ).toEqual([fixture.targetCategory]);
    const audit = (
      await fixture.db.query(
        "SELECT metadata FROM audit_logs WHERE target=$1 AND action='classify-candidate'",
        [acceptedCandidate.id],
      )
    ).rows[0];
    expect(audit.metadata).toMatchObject({
      priorDifficulty: "easy",
      difficulty: "hard",
      priorCategoryIds: [fixture.sourceCategory],
      categoryIds: [fixture.targetCategory],
    });

    await expect(
      second.getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      }),
    ).toHaveValue("");
    const rejection =
      "رفضت السؤال بعد مراجعة مستقلّة؛ يحتاج صياغة أوضح قبل إعادة تقديمه.";
    await second
      .getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      })
      .fill(rejection);
    const rejectResponse = page.waitForResponse(
      (result) =>
        result
          .url()
          .endsWith(`/api/admin/candidates/${rejectedCandidate.id}/review`) &&
        result.request().method() === "POST",
    );
    await second
      .getByRole("button", { name: "رفض السؤال", exact: true })
      .click();
    expect((await rejectResponse).status()).toBe(200);
    await expect(second).toHaveCount(0);
    expect(
      (
        await fixture.db.query(
          "SELECT status,reason FROM candidates WHERE id=$1",
          [rejectedCandidate.id],
        )
      ).rows[0],
    ).toEqual({ status: "rejected", reason: rejection });
    expect(
      (
        await fixture.db.query("SELECT 1 FROM questions WHERE id=$1", [
          rejectedCandidate.id,
        ])
      ).rowCount,
    ).toBe(0);

    await queue.getByRole("button", { name: /^المعتمدة/ }).click();
    await queue
      .getByRole("combobox", { name: "تصفية حسب الفئة", exact: true })
      .selectOption(fixture.targetCategory);
    await expect(first).toBeVisible();
    await expect(first.getByText("معتمد", { exact: true })).toBeVisible();
    await expect(first.getByText("صعب", { exact: true })).toBeVisible();
    await expect(first.getByText(verification, { exact: false })).toBeVisible();
    await expect(
      first.getByRole("button", { name: "اعتماد السؤال", exact: true }),
    ).toHaveCount(0);
    await queue.getByRole("button", { name: /^المرفوضة/ }).click();
    await queue
      .getByRole("combobox", { name: "تصفية حسب الفئة", exact: true })
      .selectOption(fixture.sourceCategory);
    await expect(second).toBeVisible();
    await expect(second.getByText(rejection, { exact: false })).toBeVisible();
  } finally {
    await cleanup(fixture);
  }
});

test("A duplicate cannot be approved; rejecting it clears its queue while preserving the original pending question", async ({
  page,
}) => {
  const fixture = await administrator(page);
  try {
    const original = arithmetic(fixture.sourceCategory);
    const originalCandidate = await addCandidate(page, fixture, original);
    const duplicateCandidate = await addCandidate(page, fixture, original);
    expect(originalCandidate.status).toBe("review");
    expect(duplicateCandidate.status).toBe("duplicate");
    const queue = await openQueue(page, fixture);
    await queue.getByRole("button", { name: /^تشابه محتمل/ }).click();
    const duplicate = questionCard(queue, original.text);
    await expect(duplicate).toBeVisible();
    await expect(duplicate.getByText("مكرّر", { exact: true })).toBeVisible();
    await expect(
      duplicate.getByRole("button", { name: "اعتماد السؤال", exact: true }),
    ).toHaveCount(0);
    await duplicate
      .getByRole("combobox", { name: "مستوى الصعوبة", exact: true })
      .selectOption("medium");
    await duplicate
      .getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      })
      .fill(
        "راجعت المسودة وقارنتها بالسؤال الأصلي؛ النص والإجابة متطابقان، لذلك رفضتها.",
      );
    const rejectResponse = page.waitForResponse(
      (result) =>
        result
          .url()
          .endsWith(`/api/admin/candidates/${duplicateCandidate.id}/review`) &&
        result.request().method() === "POST",
    );
    await duplicate
      .getByRole("button", { name: "رفض السؤال", exact: true })
      .click();
    expect((await rejectResponse).status()).toBe(200);
    await expect(duplicate).toHaveCount(0);
    expect(
      (
        await fixture.db.query(
          "SELECT status,payload->>'difficulty' AS difficulty FROM candidates WHERE id=$1",
          [duplicateCandidate.id],
        )
      ).rows[0],
    ).toEqual({ status: "rejected", difficulty: "medium" });
    expect(
      (
        await fixture.db.query("SELECT status FROM candidates WHERE id=$1", [
          originalCandidate.id,
        ])
      ).rows[0].status,
    ).toBe("review");
    expect(
      (
        await fixture.db.query(
          "SELECT 1 FROM questions WHERE id=ANY($1::uuid[])",
          [fixture.candidateIds],
        )
      ).rowCount,
    ).toBe(0);
    await queue.getByRole("button", { name: /^بانتظار المراجعة/ }).click();
    await expect(questionCard(queue, original.text)).toHaveCount(1);
  } finally {
    await cleanup(fixture);
  }
});

test("An approval based on a stale draft fails visibly without publishing or overwriting the new revision", async ({
  page,
}) => {
  const fixture = await administrator(page);
  try {
    const payload = arithmetic(fixture.sourceCategory);
    const candidate = await addCandidate(page, fixture, payload);
    const queue = await openQueue(page, fixture);
    const card = questionCard(queue, payload.text);
    await expect(card).toBeVisible();
    await card
      .getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      })
      .fill("راجعت السؤال وحساب الإجابة، وسأعتمد النسخة المعروضة بعد التحقّق.");
    await checkSimilarQuestions(card);
    const changedHint = "تلميح جديد أضافه محرّر آخر بعد فتح صفحة المراجعة.";
    const edit = await page.request.post(
      `/api/admin/candidates/${candidate.id}/edit`,
      {
        headers,
        data: {
          candidate: { ...payload, hint: changedHint },
          reason: "تحديث مستقلّ للتلميح بعد فتح المراجع للسؤال في المتصفّح.",
          expectedRevision: 1,
        },
      },
    );
    expect(edit.status()).toBe(200);
    const staleApproval = await approve(page, card, candidate.id);
    expect(staleApproval.status()).toBe(409);
    expect((await staleApproval.json()).code).toBe("REVIEW_CHANGED");
    await expect(
      page.getByRole("alert").filter({ hasText: "تغيّرت المسودة" }),
    ).toBeVisible();
    await expect(card).toBeVisible();
    const current = (
      await fixture.db.query(
        "SELECT status,revision,payload FROM candidates WHERE id=$1",
        [candidate.id],
      )
    ).rows[0];
    expect(current).toMatchObject({
      status: "review",
      revision: 2,
      payload: { hint: changedHint },
    });
    expect(
      (
        await fixture.db.query("SELECT 1 FROM questions WHERE id=$1", [
          candidate.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await fixture.db.query(
          "SELECT 1 FROM audit_logs WHERE target=$1 AND action='approve-question'",
          [candidate.id],
        )
      ).rowCount,
    ).toBe(0);
    await queue
      .getByRole("button", { name: "تحديث القائمة", exact: true })
      .click();
    await expect(
      card.getByRole("textbox", {
        name: "ملاحظات المراجعة لهذا السؤال",
        exact: true,
      }),
    ).toHaveValue("");
    await expect(
      card.getByRole("button", { name: "اعتماد السؤال", exact: true }),
    ).toBeDisabled();
  } finally {
    await cleanup(fixture);
  }
});
