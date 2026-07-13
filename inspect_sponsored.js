const puppeteer = require('puppeteer');

async function inspect(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    console.log(`Inspecting "${keyword}"...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.evaluate(async () => {
      window.scrollBy(0, 1000);
      await new Promise(r => setTimeout(r, 1000));
    });

    const itemsData = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]')).slice(0, 10);
      return items.map((item, i) => {
        return {
          index: i + 1,
          title: item.querySelector('h2')?.textContent.trim() || "NO_TITLE",
          htmlSnippet: item.innerHTML.substring(0, 1000), // 最初の1000文字
          innerText: item.innerText,
          hasSponsoredClass: item.querySelector('.puis-sponsored-label-text') !== null,
          allClasses: Array.from(item.querySelectorAll('*')).map(el => el.className).filter(c => c && c.includes('sponsored'))
        };
      });
    });

    itemsData.forEach(item => {
      console.log(`--- Item ${item.index}: ${item.title} ---`);
      console.log(`  Sponsored Class Found: ${item.hasSponsoredClass}`);
      console.log(`  Sponsored-related Classes: ${item.allClasses.join(', ')}`);
      console.log(`  InnerText includes 'スポンサー': ${item.innerText.includes('スポンサー')}`);
      console.log(`  InnerText includes 'Sponsored': ${item.innerText.includes('Sponsored')}`);
      if (!item.innerText.includes('スポンサー') && !item.hasSponsoredClass) {
          // スポンサーのはずなのに見つからない場合、怪しい箇所を探す
          console.log(`  Snippet: ${item.htmlSnippet.substring(0, 300)}...`);
      }
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

inspect('ファスティング');
