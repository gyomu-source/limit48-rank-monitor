const puppeteer = require('puppeteer');

async function findItem(keyword) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
    console.log(`Searching for "${keyword}"...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // スクロール
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      await new Promise(r => setTimeout(r, 1000));
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(r => setTimeout(r, 2000));

    const titles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-component-type="s-search-result"] h2'))
        .map(h2 => h2.textContent.trim());
    });

    console.log(`Found ${titles.length} titles.`);
    const matches = titles.filter(t => t.includes('リムイット') || t.toLowerCase().includes('limit48'));
    
    if (matches.length > 0) {
      console.log('Found matches:');
      matches.forEach(m => console.log(`- ${m}`));
    } else {
      console.log('No matches found for "リムイット" or "limit48" in titles.');
      console.log('Sample titles:');
      titles.slice(0, 10).forEach((t, i) => console.log(`${i+1}: ${t}`));
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

findItem('ファスティング');
