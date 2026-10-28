// Browser test against the local dev server (node tests/dev-server.mjs must be running).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }
const U = process.env.URL || "http://localhost:8790";
const b = await chromium.launch();
let ok = 0, bad = 0; const t = (n, c, x) => { c ? ok++ : bad++; console.log((c ? "OK  " : "FAIL") + " " + n + (!c && x !== undefined ? " -> " + JSON.stringify(x) : "")); };
const errs = [];
async function page(opts) {
  const p = await b.newPage(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return p;
}
const nbsp = (s) => s.replace(/ /g, " ");
const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// ---- claims desk ----
let p = await page();
await p.goto(U + "/claims/");
await p.waitForSelector("#rec h3", { timeout: 10000 });
t("live badge on", (await p.getAttribute("#live", "class")).includes("on"));
t("claim 1 approve 12 400", nbsp(await p.textContent("#rec")).includes("12 400 CZK") && (await p.textContent("#rec")).includes("Ready to approve"));
t("reference 10 of 10", (await p.textContent("#ref")).includes("10 of 10 found"));
t("run meta shows tokens and cost", /tokens · \$0\.\d{4}/.test(await p.textContent("#runmeta")), await p.textContent("#runmeta"));
t("10 facts in table", (await p.$$("#fields tbody tr")).length === 10);
t("quotes highlighted in document", (await p.$$("#sheet mark.f")).length >= 3);
await p.click('#fields tbody tr:nth-child(4)');
t("click fact -> its document and highlight", !!(await p.$("#sheet mark.f.hl")));
// claim 2
await p.click('.qcard[data-claim="CL-2026-01187"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && document.querySelector("#rec h3").textContent.includes("Hold"));
t("claim 2 on hold", nbsp(await p.textContent("#rec")).includes("on hold"));
t("claim 2 bad marks", (await p.$$("#sheet mark.f.bad")).length >= 1);
// claim 3
await p.click('.qcard[data-claim="CL-2026-02310"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && /escalate/i.test(document.querySelector("#rec h3").textContent));
t("claim 3 escalate, sick leave 2 000", nbsp(await p.textContent("#rec")).includes("2 000 CZK"));
await p.click('.tab[data-doc="inv"]');
t("hidden text marked", !!(await p.$("#sheet .hid")) && (await p.textContent("#sheet")).includes("Hidden white-on-white"));
t("injection listed", (await p.textContent("#rejected")).includes("not followed"));
t("translation toggle offered", !!(await p.$("#tr")));
await p.click("#tr");
t("translation shown", (await p.textContent("#sheet")).includes("English translation returned by the model"));
// model switch
await p.click('#modelSeg button[data-model="sonnet"]');
await p.waitForFunction(() => /Sonnet/.test(document.getElementById("runmeta").textContent));
t("sonnet run meta", (await p.textContent("#runmeta")).includes("Claude Sonnet 5.5"));
// more claims
await p.click("#moreWrap summary");
await p.click('.qcard[data-claim="CL-2026-02391"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && /Hold/.test(document.querySelector("#rec h3").textContent));
t("claim 8 dx mismatch -> info", (await p.textContent("#checks")).includes("Different codes"));
// decision + override
await p.click('[data-act="approve"]');
t("override logged", (await p.textContent("#audit")).includes("override logged"));
// own document
await p.click('[data-ex="inject"]');
await p.click("#ownRun");
await p.waitForFunction(() => document.getElementById("ownMsg").textContent.startsWith("Done"), null, { timeout: 10000 });
t("own claim card", (await p.textContent("#queue")).includes("Your documents"));
t("own injection flagged", (await p.textContent("#rejected")).includes("not followed"));
t("own recommendation escalate", /Escalate/.test(await p.textContent("#rec")));
// evaluation
t("eval section visible", await p.isVisible("#evalSec"));
t("eval table has both models", (await p.textContent("#evalTable")).includes("Claude Sonnet 5.5"));
t("mock eval warning shown", (await p.textContent("#evalSec")).includes("local mock"));
t("no h-scroll desktop", await noH(p));
await p.close();
// phone + dark
p = await page({ viewport: { width: 375, height: 800 }, colorScheme: "dark", isMobile: true });
await p.goto(U + "/claims/");
await p.waitForSelector("#rec h3");
t("phone no h-scroll", await noH(p));
await p.screenshot({ path: process.env.SHOTS + "/claims_phone_dark.png", fullPage: false });
await p.close();
// portfolio
p = await page();
await p.goto(U + "/");
await p.waitForFunction(() => !document.getElementById("featStats").hidden);
t("portfolio featured stats", nbsp(await p.textContent("#featStats")).includes("8 of 8"));
t("portfolio links to /claims/", (await p.$$('a[href="/claims/"]')).length >= 2);
t("no claude.ai links", !(await p.content()).includes("claude.ai/artifact"));
t("calculator works", nbsp(await p.textContent("#oNeed")).includes("33 670"));
t("portfolio no h-scroll", await noH(p));
await p.screenshot({ path: process.env.SHOTS + "/portfolio_desk.png", fullPage: false });
const pp = await page({ viewport: { width: 375, height: 800 }, isMobile: true });
await pp.goto(U + "/");
t("portfolio phone no h-scroll", await noH(pp));
t("no page errors", errs.length === 0, errs);
console.log("PASS " + ok + " FAIL " + bad);
await b.close();
process.exit(bad ? 1 : 0);
