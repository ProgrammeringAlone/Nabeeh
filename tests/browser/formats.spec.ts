import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";
import {candidateSchema,insertQuestion} from "../../server/content.ts";
const types=["image","audio","video","ordering","word","choice"];
const categories:Record<string,string>={};
test.beforeAll(async()=>{
  if(!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_e2e")) throw new Error("Format fixtures require the isolated browser-test runner");
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const pack=JSON.parse(await readFile("media/release-pack.json","utf8"));
  for(const type of types) {
    const cat="fixture_"+type+"_"+randomUUID().slice(0,8);categories[type]=cat;
    await db.query("INSERT INTO categories(id,name,description,icon,color) VALUES($1,$2,'مساحة اختبار مستقلة','◇','#eee')",[cat,"اختبار "+type]);
    for(const [i,difficulty] of ["easy","medium","hard"].entries()) {
      const original=type==="choice" ? pack.questions.find((q:any)=>q.categoryIds[0]==="logic" && q.difficulty===difficulty) : pack.questions.find((q:any)=>q.format===type && q.difficulty===difficulty);
      const c=candidateSchema.parse({...original,text:original.text+" (اختبار "+cat+")",factKey:cat+":"+i,subject:original.subject+":"+cat,categoryIds:[cat],format:type,difficulty,...(type==="choice"?{options:[original.answer,"999","1001"]}:{})});
      await insertQuestion(db,c);
    }
  }
  await db.end();
});
test("All media formats, keyboard ordering and choice responses play, persist, and respect reveal/ownership",async({page,browser})=>{
  await page.goto("/");
  await expect(page.getByRole("heading",{name:/اللّمّة تحلى/})).toBeVisible();
  for(const type of types) {
    const create=await page.request.post("/api/games",{headers:{"X-Nabeeh-Request":"1"},data:{categoryIds:[categories[type]],teamNames:["ألف","باء"],timer:180}});
    expect(create.status()).toBe(201);const {id}=await create.json();
    const state=await (await page.request.get("/api/games/"+id)).json();const tile=state.tiles[0];
    if(["image","audio","video"].includes(type)) expect((await page.request.get(`/api/games/${id}/media/${tile.id}`)).status()).toBe(404);
    await page.goto("/#/game/"+id);
    await page.getByRole("button",{name:/200 نقطة$/}).click();
    await expect(page.getByTestId("question-text")).toBeVisible();
    const opened=await (await page.request.get("/api/games/"+id)).json();expect(opened.current.answer).toBeNull();expect(opened.current.ordering_answer).toBeNull();
    if(type==="image") await expect(page.locator(".question-media img")).toBeVisible();
    if(type==="audio" || type==="video") {
      await expect(page.locator(".question-media "+type)).toBeVisible();
      await page.locator(".question-media "+type).evaluate((element:HTMLMediaElement)=>element.play());
      await expect.poll(()=>page.locator(".question-media "+type).evaluate((element:HTMLMediaElement)=>element.currentTime)).toBeGreaterThan(0);
    }
    await expect(page.getByTestId("question-text")).toHaveCount(1);
    await expect(page.getByRole("heading",{name:opened.current.text,exact:true})).toHaveCount(1);
    if(["image","audio","video"].includes(type)) {
      const media=await page.request.get(`/api/games/${id}/media/${tile.id}`);expect(media.status()).toBe(200);expect((await media.body()).length).toBeGreaterThan(100);
      const range=await page.request.get(`/api/games/${id}/media/${tile.id}`,{headers:{Range:"bytes=0-31"}});expect(range.status()).toBe(206);expect((await range.body()).length).toBe(32);
      const stranger=await browser.newContext();expect((await stranger.request.get(new URL(`/api/games/${id}/media/${tile.id}`,page.url()).href)).status()).toBe(404);await stranger.close();
    }
    if(type==="ordering") {
      const items=[...opened.current.options];[items[0],items[1]]=[items[1],items[0]];
      await page.getByRole("button",{name:/^أخّر /}).first().click();
      await expect.poll(()=>page.locator(".ordering-challenge li > span").allTextContents()).toEqual(items);await page.reload();
      await expect.poll(()=>page.locator(".ordering-challenge li > span").allTextContents()).toEqual(items);
    }
    if(type==="choice") {
      await page.locator(".choice-challenge button").first().click();await expect(page.locator('.choice-challenge button[aria-pressed="true"]')).toHaveCount(1);await page.reload();await expect(page.locator('.choice-challenge button[aria-pressed="true"]')).toHaveCount(1);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.screenshot({path:`test-results/${type}-${test.info().project.name}.png`,fullPage:true});
    await page.getByRole("button",{name:"اكشف الإجابة"}).click();await expect(page.getByTestId("answer-text")).toBeVisible();
    await page.request.post(`/api/games/${id}/abandon`,{headers:{"X-Nabeeh-Request":"1"},data:{}});
  }
});
test("Account recovery rotates its key and accepts the new password while rejecting the old one",async({page})=>{
  await page.goto("/#/account");const username="recover_"+randomUUID().replaceAll("-","").slice(0,18);
  const register=await page.request.post("/api/auth/register",{headers:{"X-Nabeeh-Request":"1"},data:{username,password:"old browser password"}});
  expect(register.status()).toBe(200);const {recoveryKey}=await register.json();
  await page.reload();
  await page.getByRole("button",{name:"تسجيل الخروج",exact:true}).click();
  await page.getByRole("button",{name:"تسجيل الدخول",exact:true}).click();await page.getByRole("button",{name:"نسيت كلمة المرور؟"}).click();
  await page.getByLabel("اسم المستخدم",{exact:false}).fill(username);await page.getByLabel("مفتاح الاستعادة",{exact:false}).fill(recoveryKey);
  await page.getByLabel("كلمة المرور",{exact:false}).fill("new browser password");await page.getByRole("button",{name:"غيّر كلمة المرور"}).click();
  await expect(page.getByRole("heading",{name:"احفظ مفتاحك الآن"})).toBeVisible();
  expect((await page.request.post("/api/auth/login",{headers:{"X-Nabeeh-Request":"1"},data:{username,password:"old browser password"}})).status()).toBe(401);
  await page.getByLabel("كلمة المرور",{exact:false}).fill("new browser password");await page.getByRole("button",{name:"دخول",exact:true}).click();await expect(page.getByRole("heading",{name:/أهلًا/})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
