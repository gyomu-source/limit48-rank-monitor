const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const TARGET_ID = 'limit48'; // 楽天用
const HISTORY_FILE = path.join(__dirname, 'rank_history.json');

async function checkRakuten(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 300;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if(totalHeight >= 2000 || totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });

    const results = await page.evaluate((targetId) => {
      const items = Array.from(document.querySelectorAll('.searchresultitem'));
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let found = false;

      for (const item of items) {
        const isPR = item.querySelector('.service_icon--3_oX1') !== null || item.textContent.includes('PR');
        if (isPR) {
          prCount++;
        } else {
          organicRank++;
          const links = Array.from(item.querySelectorAll('a'));
          const isTarget = links.some(link => link.href.includes(targetId));
          if (isTarget && !found) {
            targetRank = organicRank;
            targetTotalRank = organicRank + prCount;
            found = true;
          }
        }
        if (organicRank >= 100) break;
      }
      return { rank: targetTotalRank, organicRank: targetRank, prCount: prCount };
    }, TARGET_ID);

    return results;
  } catch (error) {
    console.error(`Rakuten Error (${keyword}):`, error.message);
    return { rank: null, organicRank: null, prCount: 0 };
  } finally {
    await browser.close();
  }
}

async function checkAmazon(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=ja-JP,ja'
    ]
  });
  const page = await browser.newPage();
  
  // ブラウザ指紋の偽装
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  try {
    // 1. トップページへ
    await page.goto("https://www.amazon.co.jp/", { waitUntil: "networkidle0", timeout: 180000 });
    await new Promise(r => setTimeout(r, 5000)); // ページが完全にロードされるまで待機

    // ポップアップを閉じる試行
    try {
      const closeButton = await page.$("button[data-action=\'a-popover-close\"]");
      if (closeButton) {
        await closeButton.click();
        console.log("    [Amazon] ポップアップを閉じました。");
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log("    [Amazon] ポップアップを閉じる際にエラー:", e.message);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 2. お届け先設定 (一時的に無効化)
    console.log('    [Amazon] お届け先設定の処理を一時的にスキップします。');
    await new Promise(r => setTimeout(r, 2000));

    // 3. 検索 (検索窓に入力する動作をシミュレート、失敗時はURL直接遷移)
    try {
        await page.waitForSelector("#twotabsearchtextbox", { visible: true, timeout: 10000 });
        await page.type("#twotabsearchtextbox", keyword);
        await Promise.all([
          page.keyboard.press("Enter"),
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
        ]);
    } catch (searchError) {
        console.log("    [Amazon] 検索ボックスが見つからないため、URLを直接開きます:", searchError.message);
        const searchUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
        await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
    }
    
    // ロボット確認
    if (await page.$("#captchacharacters")) {
      console.log("    [Amazon] ロボット確認画面を検知しました。");
      return { rank: null, organicRank: null, prCount: 0 };
    }

    // じっくりスクロール
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
    }
    
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".s-result-item[data-asin]"));
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let foundInOrganic = false;

      for (const item of items) {
        if (item.getAttribute("data-asin") === "") continue;

        // スポンサー判定 (より詳細に)
        const isSponsored = item.querySelector(".puis-sponsored-label-text, .s-label-popover-default, .s-sponsored-label-info-icon, .s-label-popover, .AdHolder") !== null || 
                            item.innerText.includes("スポンサー") || 
                            item.innerText.includes("Sponsored") ||
                            item.innerHTML.includes("sponsored-label");
        
        const titleEl = item.querySelector("h2");
        const title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) continue;

        if (isSponsored) {
          prCount++;
        } else {
          organicRank++;
          const lowerTitle = title.toLowerCase();
          const isTarget = lowerTitle.includes("limit") || 
                           lowerTitle.includes("リムイット") || 
                           lowerTitle.includes("lim:it");
          
          if (isTarget && !foundInOrganic) {
            targetRank = organicRank;
            targetTotalRank = organicRank + prCount;
            foundInOrganic = true;
          }
        }
        if (organicRank >= 100) break;
      }
      return { rank: targetTotalRank, organicRank: targetRank, prCount: prCount };
    });

    return results;
  } catch (error) {
    console.error(`Amazon Error (${keyword}):`, error.message);
    return { rank: null, organicRank: null, prCount: 0 };
  }
  finally {
    await browser.close();
  }
}

async function run() {
  console.log(`[${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST] 順位チェック開始 (楽天 & Amazon)`);
  
  const results = {
    rakuten: {},
    amazon: {}
  };

  for (const kw of KEYWORDS) {
    console.log(`  楽天: 「${kw}」を検索中...`);
    results.rakuten[kw] = await checkRakuten(kw);
    console.log(`    → トータル${results.rakuten[kw].rank || '圏外'}位 (PR${results.rakuten[kw].prCount}件)`);
    
    console.log(`  Amazon: 「${kw}」を検索中...`);
    results.amazon[kw] = await checkAmazon(kw);
    console.log(`    → トータル${results.amazon[kw].rank || '圏外'}位 (スポンサー${results.amazon[kw].prCount}件)`);
  }

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  }

  const now = new Date();
  const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  history.push({
    timestamp: now.toISOString(),
    dateStr: `${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}/${String(jstNow.getUTCDate()).padStart(2, '0')}`,
    timeStr: `${String(jstNow.getUTCHours()).padStart(2, '0')}:${String(jstNow.getUTCMinutes()).padStart(2, '0')}`,
    results: results
  });

  if (history.length > 100) history = history.slice(-100);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`[完了] ${path.basename(HISTORY_FILE)} 更新（${history.length}件）`);
}

run();
