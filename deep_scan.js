const puppeteer = require('puppeteer');

async function deepScan(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    console.log(`Deep scanning "${keyword}"...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 全体をスクロール
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, 1000);
        await new Promise(r => setTimeout(r, 500));
      }
    });

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return items.map((item, index) => {
        const title = item.querySelector('h2')?.textContent.trim() || "";
        const text = item.textContent.toLowerCase();
        return {
          index: index + 1,
          title: title,
          hasLimit: text.includes('limit') || text.includes('リムイット'),
          isSponsored: item.querySelector('.puis-sponsored-label-text, .s-label-popover-default, .s-sponsored-label-info-icon') !== null
        };
      });
    });

    console.log(`Found ${results.length} total items.`);
    const matches = results.filter(r => r.hasLimit);
    
    if (matches.length > 0) {
      console.log('--- Matches Found ---');
      matches.forEach(m => {
        console.log(`Rank: ${m.index}, Sponsored: ${m.isSponsored}, Title: ${m.title}`);
      });
    } else {
      console.log('No matches found for "limit" or "リムイット" in the first 50 results.');
      console.log('Listing first 10 titles for context:');
      results.slice(0, 10).forEach(r => console.log(`- ${r.title}`));
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

deepScan('ファスティング');
