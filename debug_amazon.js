const puppeteer = require('puppeteer');

async function debugAmazon(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 少し待機
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return items.map(item => ({
        title: item.querySelector('h2')?.textContent.trim() || "NO_TITLE",
        asin: item.getAttribute('data-asin') || "NO_ASIN",
        text: item.textContent.substring(0, 100)
      }));
    });

    console.log(`Found ${data.length} items.`);
    if (data.length > 0) {
      console.log('First 3 items titles:');
      data.slice(0, 3).forEach((item, i) => console.log(`${i+1}: ${item.title} (${item.asin})`));
    } else {
      console.log('No search results found. Checking body text...');
      const bodyText = await page.evaluate(() => document.body.textContent.substring(0, 500));
      console.log('Body start:', bodyText);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

debugAmazon('ファスティング');
