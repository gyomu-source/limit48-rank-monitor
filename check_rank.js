const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const TARGET_ID = 'limit48';
const HISTORY_FILE = path.join(__dirname, 'rank_history.json');

async function checkRank(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  // 実際のブラウザに近いUser-Agentを設定
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/`;
    console.log(`  Navigating to: ${url}`);
    
    // ページ遷移。RPP広告が読み込まれるまで少し待機
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // RPP広告などの動的コンテンツの読み込みを確実にするため、少しスクロール
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
    
    // 読み込み待ち
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate((targetId) => {
      // 商品カードと思われる要素をすべて取得
      // 楽天の検索結果は .searchresultitem や .dui-card などのクラスを持つ
      const items = Array.from(document.querySelectorAll('.searchresultitem, .dui-card[data-index], [data-index]'));
      
      let prCount = 0;
      let organicRank = 0;
      let targetRank = null;
      let targetTotalRank = null;
      let found = false;

      // 重複カウント防止用のSet（商品名やURLの一部で判定）
      const seenItems = new Set();

      for (const item of items) {
        const text = item.textContent || "";
        const html = item.innerHTML || "";
        
        // 1. 重複チェック
        // 商品名の一部や特定のIDがあればそれを使う。なければテキストのハッシュ的なもの
        const itemKey = text.substring(0, 100);
        if (seenItems.has(itemKey)) continue;
        seenItems.add(itemKey);

        // 2. PR判定
        // - テキストに [PR] が含まれる
        // - 楽天独自のPR用データ属性がある
        // - 特定の広告用クラスがある
        const isPR = text.includes('[PR]') || 
                     text.includes('広告') || 
                     html.includes('data-log-type="ad"') ||
                     item.querySelector('.rpp_ichiba_top') !== null;

        if (isPR) {
          prCount++;
        } else {
          organicRank++;
          
          // 3. 自社商品の判定
          const links = Array.from(item.querySelectorAll('a')).map(a => a.href).join(' ');
          if (links.includes(targetId) || text.includes(targetId)) {
            if (!found) {
              targetRank = organicRank;
              targetTotalRank = organicRank + prCount;
              found = true;
            }
          }
        }
        
        // 100位まで見れば十分
        if (organicRank >= 100) break;
      }

      return {
        rank: targetTotalRank,
        organicRank: targetRank,
        prCount: prCount
      };
    }, TARGET_ID);

    await browser.close();
    return results;

  } catch (error) {
    console.error(`  Error checking ${keyword}:`, error.message);
    await browser.close();
    return { rank: null, organicRank: null, prCount: 0, error: error.message };
  }
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${String(jst.getUTCMonth()+1).padStart(2,'0')}/${String(jst.getUTCDate()).padStart(2,'0')}`;
  const timeStr = `${String(jst.getUTCHours()).padStart(2,'0')}:${String(jst.getUTCMinutes()).padStart(2,'0')}`;

  console.log(`[${dateStr} ${timeStr} JST] 順位チェック開始 (ブラウザモード)`);

  const results = {};
  for (const kw of KEYWORDS) {
    console.log(`  「${kw}」を検索中...`);
    const r = await checkRank(kw);
    results[kw] = r;
    
    if (r.organicRank) {
      console.log(`    → 純粋${r.organicRank}位 / トータル${r.rank}位 (PR${r.prCount}件込み)`);
    } else {
      console.log(`    → 圏外または取得失敗 (${r.error || '100位以内未登場'})`);
    }
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
    results
  });

  if (history.length > 180) history = history.slice(-180);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  console.log(`[完了] rank_history.json 更新（${history.length}件）`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
