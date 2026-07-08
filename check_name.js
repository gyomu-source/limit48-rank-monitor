const puppeteer = require('puppeteer');

async function checkName() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent('リムイット48')}`;
    console.log(`Searching for "リムイット48" to find official product name...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    const firstTitle = await page.evaluate(() => {
      return document.querySelector('[data-component-type="s-search-result"] h2')?.textContent.trim();
    });

    console.log(`First product found: "${firstTitle}"`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

checkName();
