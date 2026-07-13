const puppeteer = require('puppeteer');
const fs = require('fs');

async function debugVisual(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await new Promise(r => setTimeout(r, 5000));

    const content = await page.content();
    fs.writeFileSync('amazon_debug.html', content);
    await page.screenshot({ path: 'amazon_debug.png' });

    const isCaptcha = content.includes('captcha') || content.includes('ロボットではない');
    console.log(`Is CAPTCHA present? ${isCaptcha}`);

    const resultsCount = await page.evaluate(() => document.querySelectorAll('[data-component-type="s-search-result"]').length);
    console.log(`Search results found: ${resultsCount}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

debugVisual('ファスティング');
