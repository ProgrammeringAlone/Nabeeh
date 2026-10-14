import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const root = ".local/research";
await mkdir(root, { recursive: true });
const raw = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxy = raw ? new URL(raw) : null;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
  proxy: proxy
    ? {
        server: proxy.origin,
        username: proxy.username,
        password: proxy.password,
      }
    : undefined,
});
const results = [];
for (const [i, url] of [
  "https://jawabha.ae/",
  "https://seenjeemkw.com/",
  "https://www.asbghm.com/",
  "https://befateen.com/",
  "https://jam3aa.com/",
  "https://seenso2al.com/",
].entries()) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const evidence: {
    url: string;
    timestamp: string;
    status?: number;
    error?: string;
    pages: unknown[];
  } = { url, timestamp: new Date().toISOString(), pages: [] };
  try {
    const response = await page.goto(url, {
      timeout: 25_000,
      waitUntil: "domcontentloaded",
    });
    evidence.status = response?.status();
    await page.screenshot({
      path: `${root}/site-${i + 1}.png`,
      fullPage: true,
    });
    const text = await page.locator("body").innerText();
    await writeFile(`${root}/site-${i + 1}.txt`, text);
    if (response?.ok()) {
      const links = await page
        .locator("a[href]")
        .evaluateAll((els) =>
          els.map((e) => ({
            url: (e as HTMLAnchorElement).href,
            label: (e.textContent || "").trim(),
          })),
        );
      evidence.pages.push({ url: page.url(), text, links });
      const publicLinks = [
        ...new Set(
          links
            .filter((l) => {
              try {
                return (
                  new URL(l.url).hostname === new URL(url).hostname &&
                  /faq|rules|how|about|price|categor|demo|trial|سؤال|قواعد|فئات|تجرب|الأسئلة|طريقة/i.test(
                    l.url + " " + l.label,
                  )
                );
              } catch {
                return false;
              }
            })
            .map((l) => l.url),
        ),
      ].slice(0, 20);
      for (const [j, link] of publicLinks.entries())
        try {
          const r = await page.goto(link, {
            timeout: 15_000,
            waitUntil: "domcontentloaded",
          });
          evidence.pages.push({
            url: link,
            status: r?.status(),
            text: await page.locator("body").innerText(),
          });
          await page.screenshot({
            path: `${root}/site-${i + 1}-page-${j + 1}.png`,
            fullPage: true,
          });
        } catch {
          evidence.pages.push({ url: link, error: "Navigation failed" });
        }
    }
  } catch (e) {
    evidence.error =
      e instanceof Error ? e.message.split("\n")[0] : "Navigation failed";
  }
  results.push(evidence);
  console.log(
    url,
    evidence.status || evidence.error,
    "public pages:",
    evidence.pages.length,
  );
  await context.close();
}
await browser.close();
await writeFile(`${root}/evidence.json`, JSON.stringify(results, null, 2));
