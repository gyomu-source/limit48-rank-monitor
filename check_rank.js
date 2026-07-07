// 楽天キーワード順位チェッカー v5
// v5追加: PR（広告）件数・純粋順位の記録

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HISTORY_FILE = path.join(__dirname, 'rank_history.json');
const KEYWORDS = ['ファスティング', '酵素ドリンク'];
const MAX_PAGES = 5;
const SHOP_CODE = 'limit48';
const MAX_REDIRECTS = 5;

function fetchUrl(targetUrl, redirectCount) {
  if (redirectCount === undefined) redirectCount = 0;
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error('Too many redirects'));
    }

    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Connection': 'keep-alive',
      }
    };

    const req = lib.request(options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 ||
           res.statusCode === 307 || res.statusCode === 308)
          && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        return resolve(fetchUrl(redirectUrl, redirectCount + 1));
      }

      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        if (enc === 'gzip') {
          zlib.gunzip(buf, (err, d) => err ? reject(err) : resolve(d.toString('utf8')));
        } else if (enc === 'br') {
          zlib.brotliDecompress(buf, (err, d) => err ? reject(err) : resolve(d.toString('utf8')));
        } else if (enc === 'deflate') {
          zlib.inflate(buf, (err, d) => err ? reject(err) : resolve(d.toString('utf8')));
        } else {
          resolve(buf.toString('utf8'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Request timeout')); });
    req.end();
  });
}

function fetchPage(keyword, page) {
  const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/?p=${page}`;
  return fetchUrl(url, 0);
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

// PR（広告）アイテムを検出する
// 戻り値: { prCount, prShopFound, prSource, prIndexes }
function analyzePR(search) {
  const result = {
    prCount: null,     // null = 検出不能
    prShopFound: false,
    prSource: 'unknown',
    prIndexes: [],     // items配列内でPRの位置（prSource=itemFlagの場合のみ）
  };

  // Strategy 1: 別配列が存在する場合（adItems / sponsoredItems 等）
  for (const key of ['adItems', 'sponsoredItems', 'promotionItems', 'prItems', 'topItems']) {
    if (search[key] && Array.isArray(search[key])) {
      result.prCount = search[key].length;
      result.prSource = key;
      result.prShopFound = search[key].some(item => {
        const url = item.url || item.originalItemUrl || '';
        return url.includes('/' + SHOP_CODE + '/');
      });
      console.log(`  [PR検出] 別配列「${key}」: ${result.prCount}件${result.prShopFound ? ' ★自店PR出稿中' : ''}`);
      return result;
    }
  }

  // Strategy 2: items配列内にadフラグが存在する場合
  if (search.items && search.items.length > 0) {
    const firstItem = search.items[0];
    const adFields = ['adType', 'isAd', 'sponsored', 'adPosition', 'promotionType', 'mediaType'];
    const hasAdField = adFields.some(f => f in firstItem);

    if (hasAdField) {
      search.items.forEach((item, idx) => {
        const isAd = item.adType != null || item.isAd === true ||
                     item.sponsored === true || item.mediaType === 'ad' ||
                     item.adPosition != null || item.promotionType != null;
        if (isAd) {
          result.prIndexes.push(idx);
          const url = item.url || item.originalItemUrl || '';
          if (url.includes('/' + SHOP_CODE + '/')) result.prShopFound = true;
        }
      });
      result.prCount = result.prIndexes.length;
      result.prSource = 'itemFlag';
      console.log(`  [PR検出] itemフラグ: ${result.prCount}件${result.prShopFound ? ' ★自店PR出稿中' : ''}`);
      return result;
    }
  }

  // Strategy 3: 検出できなかった — RPP広告はJavaScript動的読み込みのためサーバーサイドでは取得不可
  // __INITIAL_STATE__.ichibaSearch.items は純粋な検索結果のみを含む（PR混入なし）
  // → rank = organicRank が常に成立する
  console.log(`  [PR非対応] RPP広告は動的読み込みのため取得不可。この順位 = 純粋順位`);
  return result;
}

async function findRank(keyword) {
  let prInfo = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const html = await fetchPage(keyword, page);
      const state = parseInitialState(html);

      if (!state) {
        const preview = html.replace(/\s+/g, ' ').substring(0, 300);
        return { rank: null, error: `__INITIAL_STATE__ が取得できませんでした (${preview})` };
      }

      const search = state.state.data.ichibaSearch;
      if (!search || !search.items) {
        return { rank: null, error: '検索結果データが見つかりません' };
      }

      // ページ1でPR分析
      if (page === 1) {
        prInfo = analyzePR(search);
      }

      const pageSize = (search.pagination && search.pagination.pageSize) || 45;
      const offset = (page - 1) * pageSize;

      for (let i = 0; i < search.items.length; i++) {
        const item = search.items[i];
        const url = item.url || item.originalItemUrl || '';
        if (url.includes('/' + SHOP_CODE + '/')) {
          const totalRank = offset + i + 1;

          // 純粋順位の計算
          // prSource=itemFlag の場合: items配列内にPRが混在 → 自分より前のPR件数を引く
          // prSource=別配列 の場合: items配列はすでに純粋結果 → そのままが純粋順位
          let organicRank = totalRank;
          if (prInfo && prInfo.prSource === 'itemFlag' && page === 1) {
            const prBeforeUs = prInfo.prIndexes.filter(idx => idx < i).length;
            organicRank = totalRank - prBeforeUs;
          }

          return {
            rank: totalRank,
            organicRank,
            isPR: false,
            prCount: prInfo ? prInfo.prCount : null,
            prShopFound: prInfo ? prInfo.prShopFound : false,
            itemName: item.name,
            shopCode: SHOP_CODE,
          };
        }
      }

      if (page < MAX_PAGES) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) {
      return { rank: null, error: e.message };
    }
  }

  // 全ページ検索後: PR枠のみ出稿中（純粋順位は圏外）
  if (prInfo && prInfo.prShopFound) {
    return {
      rank: null,
      organicRank: null,
      isPR: true,
      prCount: prInfo.prCount,
      prShopFound: true,
      error: `PR枠のみ出稿中（純粋順位 ${MAX_PAGES * 45}位以内に未登場）`,
    };
  }

  return {
    rank: null,
    organicRank: null,
    isPR: false,
    prCount: prInfo ? prInfo.prCount : null,
    error: `${MAX_PAGES}ページ（${MAX_PAGES * 45}位）以内に未登場`,
  };
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

    if (r.isPR) {
      console.log(`  → PR枠のみ出稿中（純粋順位：圏外）PR件数: ${r.prCount}`);
    } else if (r.rank) {
      const prInfo = r.prCount !== null ? ` PR${r.prCount}件` : '';
      const organicInfo = (r.organicRank && r.organicRank !== r.rank)
        ? ` / 純粋${r.organicRank}位` : '';
      console.log(`  → ${r.rank}位${organicInfo}${prInfo}`);
    } else {
      console.log(`  → 圏外（${r.error}）`);
    }
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
