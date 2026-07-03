// 楽天キーワード順位チェッカー v3
// search.rakuten.co.jp の __INITIAL_STATE__ JSONから正確な順位を取得

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'rank_history.json');
const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const MAX_PAGES = 5;
const SHOP_CODE = 'limit48';

function fetchPage(keyword, page) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'search.rakuten.co.jp',
      path: '/search/mall/' + encodeURIComponent(keyword) + '/?p=' + page,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      }
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        if (enc === 'gzip') {
          zlib.gunzip(buf, (err, d) => err ? reject(err) : resolve(d.toString('utf8')));
        } else if (enc === 'br') {
          zlib.brotliDecompress(buf, (err, d) => err ? reject(err) : resolve(d.toString('utf8')));
        } else {
          resolve(buf.toString('utf8'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?);\s*(?:window\.|<\/script>)/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch(e) {
    return null;
  }
}

async function findRank(keyword) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const html = await fetchPage(keyword, page);
      const state = parseInitialState(html);

      if (!state) {
        return { rank: null, error: '__INITIAL_STATE__ が取得できませんでした' };
      }

      const search = state.state.data.ichibaSearch;
      if (!search || !search.items) {
        return { rank: null, error: '検索結果データが見つかりません' };
      }

      const pageSize = search.pagination.pageSize || 45;
      const offset = (page - 1) * pageSize;

      for (let i = 0; i < search.items.length; i++) {
        const item = search.items[i];
        const url = item.url || item.originalItemUrl || '';
        if (url.includes('/' + SHOP_CODE + '/')) {
          const rank = offset + i + 1;
          return {
            rank,
            itemName: item.name,
            shopCode: SHOP_CODE,
          };
        }
      }

      if (page < MAX_PAGES) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      return { rank: null, error: e.message };
    }
  }
  return { rank: null, error: `${MAX_PAGES}ページ（${MAX_PAGES * 45}位）以内に未登場` };
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${String(jst.getUTCMonth()+1).padStart(2,'0')}/${String(jst.getUTCDate()).padStart(2,'0')}`;
  const timeStr = `${String(jst.getUTCHours()).padStart(2,'0')}:${String(jst.getUTCMinutes()).padStart(2,'0')}`;

  console.log(`[${dateStr} ${timeStr} JST] 順位チェック開始`);

  const results = {};
  for (const kw of KEYWORDS) {
    console.log(`  「${kw}」を検索中...`);
    const r = await findRank(kw);
    results[kw] = r;
    console.log(`  → ${r.rank ? r.rank + '位' : '圏外（' + r.error + '）'}`);
  }

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) {}
  }
  history.push({ timestamp: now.toISOString(), dateStr, timeStr, results });
  if (history.length > 180) history = history.slice(-180);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  console.log(`[完了] rank_history.json 更新（${history.length}件）`);
}

main().catch(e => { console.error(e); process.exit(1); });
