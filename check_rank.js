const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const TARGET_ID = 'limit48'; // 楽天用
const TARGET_BRAND = 'リムイット'; // Amazon用 (判定を少し甘くする)
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
        let distance = 200;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if(totalHeight >= 1500 || totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate((targetId) => {
      const items = Array.from(document.querySelectorAll('.searchresultitem, .dui-card[data-index], [data-index]'));
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let found = false;
      const seenItems = new Set();

      for (const item of items) {
        const text = item.textContent || "";
        const html = item.innerHTML || "";
        const itemKey = text.substring(0, 100);
        if (seenItems.has(itemKey)) continue;
        seenItems.add(itemKey);

        const isPR = text.includes('[PR]') || 
                     text.includes('広告') || 
                     html.includes('data-log-type="ad"') ||
                     item.querySelector('.rpp_ichiba_top') !== null;

        if (isPR) {
          prCount++;
        } else {
          organicRank++;
          const links = Array.from(item.querySelectorAll('a')).map(a => a.href).join(' ');
          if (links.includes(targetId) || text.includes(targetId)) {
            if (!found) {
              targetRank = organicRank;
              targetTotalRank = organicRank + prCount;
              found = true;
            }
          }
        }
        if (organicRank >= 100) break;
      }
      return { rank: targetTotalRank, organicRank: targetRank, prCount: prCount };
    }, TARGET_ID);

    await browser.close();
    return results;
  } catch (error) {
    console.error(`  Rakuten Error ${keyword}:`, error.message);
    await browser.close();
    return { rank: null, organicRank: null, prCount: 0, error: error.message };
  }
}

async function checkAmazon(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 400;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          // Amazonは下までスクロールしないと広告が出きらないことがあるため、少し深めに
          if(totalHeight >= 3000 || totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate((targetBrand) => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let found = false;

      for (const item of items) {
        const isSponsored = item.querySelector('.puis-sponsored-label-text, .s-label-popover-default, .s-sponsored-label-info-icon') !== null || 
                            item.textContent.includes('スポンサー') || 
                            item.textContent.includes('Sponsored');
        const title = item.querySelector('h2')?.textContent || "";

        if (isSponsored) {
          prCount++;
        } else {
          organicRank++;
          // 大文字小文字や表記揺れを考慮
          const lowerTitle = title.toLowerCase();
          const isTarget = lowerTitle.includes('limit') || 
                           lowerTitle.includes('リムイット') || 
                           lowerTitle.includes('the limit');
          
          if (isTarget) {
            if (!found) {
              targetRank = organicRank;
              targetTotalRank = organicRank + prCount;
              found = true;
            }
          }
        }
        if (organicRank >= 100) break;
      }
      return { rank: targetTotalRank, organicRank: targetRank, prCount: prCount };
    }, TARGET_BRAND);

    await browser.close();
    return results;
  } catch (error) {
    console.error(`  Amazon Error ${keyword}:`, error.message);
    await browser.close();
    return { rank: null, organicRank: null, prCount: 0, error: error.message };
  }
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${String(jst.getUTCMonth()+1).padStart(2,'0')}/${String(jst.getUTCDate()).padStart(2,'0')}`;
  const timeStr = `${String(jst.getUTCHours()).padStart(2,'0')}:${String(jst.getUTCMinutes()).padStart(2,'0')}`;

  console.log(`[${dateStr} ${timeStr} JST] 順位チェック開始 (楽天 & Amazon)`);

  const results = { rakuten: {}, amazon: {} };
  
  for (const kw of KEYWORDS) {
    console.log(`  楽天: 「${kw}」を検索中...`);
    results.rakuten[kw] = await checkRakuten(kw);
    console.log(`    → トータル${results.rakuten[kw].rank || '圏外'}位 (PR${results.rakuten[kw].prCount}件)`);

    console.log(`  Amazon: 「${kw}」を検索中...`);
    results.amazon[kw] = await checkAmazon(kw);
    console.log(`    → トータル${results.amazon[kw].rank || '圏外'}位 (PR${results.amazon[kw].prCount}件)`);
  }

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
      console.error("  History file read error:", e.message);
    }
  }

  history.push({
    timestamp: now.toISOString(),
    dateStr,
    timeStr,
    results // 以前は kw が直接 results の直下にあったが、これからは rakuten/amazon で分ける
  });

  if (history.length > 200) history = history.slice(-200);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  console.log(`[完了] rank_history.json 更新（${history.length}件）`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
