const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const TARGET_ID = 'limit48'; // 楽天用
const TARGET_BRAND = 'リムイット'; // Amazon用
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
      '--lang=ja-JP,ja'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 4000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    // 1. まずトップページに行く (ボット回避)
    await page.goto('https://www.amazon.co.jp/', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

    // 2. 検索を実行
    const searchUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // ロボット確認画面が出ていないかチェック
    const isCaptcha = await page.evaluate(() => document.body.innerText.includes('ロボット') || document.body.innerText.includes('CAPTCHA'));
    if (isCaptcha) {
      console.log(`    [Amazon] ロボット確認画面が表示されました。スキップします。`);
      return { rank: null, organicRank: null, prCount: 0 };
    }

    // スクロール
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.scrollBy(0, 400);
        await new Promise(r => setTimeout(r, 500));
      }
    });
    
    await new Promise(r => setTimeout(r, 3000));

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.s-result-item[data-asin]'));
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let found = false;

      for (const item of items) {
        // Amazonのスポンサー判定 (究極版)
        const itemHtml = item.innerHTML || "";
        const itemText = item.innerText || "";
        
        let isSponsored = item.querySelector('.puis-sponsored-label-text, .s-label-popover-default, .s-sponsored-label-info-icon, .s-label-popover, .puis-label-popover-default, [data-component-type="sp-ad-result"]') !== null || 
                          item.classList.contains('AdHolder') ||
                          itemText.includes('スポンサー') || 
                          itemText.includes('Sponsored') ||
                          itemHtml.includes('sponsored') || 
                          itemHtml.includes('ad-result');
        
        const titleEl = item.querySelector('h2');
        const title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) continue;

        if (isSponsored) {
          prCount++;
        } else {
          organicRank++;
          const lowerTitle = title.toLowerCase();
          const isTarget = /limit|リムイット|the\s*limit/i.test(lowerTitle);
          
          if (isTarget && !found) {
            targetRank = organicRank;
            targetTotalRank = organicRank + prCount;
            found = true;
          }
        }
      }
      return { rank: targetTotalRank, organicRank: targetRank, prCount: prCount };
    });

    return results;
  } catch (error) {
    console.error(`Amazon Error (${keyword}):`, error.message);
    return { rank: null, organicRank: null, prCount: 0 };
  } finally {
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
