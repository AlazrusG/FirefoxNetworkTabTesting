// fetch_network_firefox.js

const fs = require('fs');
const { firefox } = require('playwright'); // playright must be installed
const path = require('path');

const outDir = path.join(__dirname, 'test-results', 'nested'); // folder inside project
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await firefox.launch({ headless: false }); // headful can help with auth flows
  const context = await browser.newContext();
  const page = await context.newPage();

  // Map to store details by request id
  const requests = new Map();

  // Listen for requests
  page.on('request', request => {
    const id = request._guid || request.url() + '|' + Date.now();
    requests.set(request, {
      id,
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      startTime: Date.now()
    });
    console.log(`REQUEST  -> ${request.method()} ${request.url()}`);
  });

  // Listen for responses
  page.on('response', async response => {
    try {
      const request = response.request();
      const entry = requests.get(request) || {};
      entry.status = response.status();
      entry.statusText = response.statusText();
      entry.responseHeaders = response.headers();
      // Try to get body (may throw for non-text/binary; handle safely)
      let body = null;
      try {
        body = await response.text();
      } catch (e) {
        try {
          const buffer = await response.body();
          body = buffer.toString('base64'); // binary -> base64
          entry.responseBodyIsBase64 = true;
        } catch (err) {
          body = `<unable to read body: ${err.message}>`;
        }
      }
      entry.responseBody = body;
      entry.endTime = Date.now();
      requests.set(request, entry);

      // Example: write each response body to disk (optional)
      const safeName = entry.id.toString().replace(/[:\/?#&= ]/g, '_').slice(0, 200);
      const filename = path.join(outDir, `response_${safeName}.txt`);
      if (entry.responseBodyIsBase64) {
        fs.writeFileSync(filename + '.b64', entry.responseBody);
      } else {
        fs.writeFileSync(filename, entry.responseBody || '');
      }

      console.log(`RESPONSE <- ${response.status()} ${response.url()} -> saved ${filename}`);
    } catch (err) {
      console.warn('Error handling response:', err);
    }
  });

  // Optional: capture failed requests
  page.on('requestfailed', request => {
    console.log(`FAILED   -> ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
  });

  // Navigate to a page (change to your target)
  await page.goto('https://example.com', { waitUntil: 'networkidle' });

  // Wait or interact as needed so background requests occur
  await page.waitForTimeout(3000);

  // Inspect collected requests
  for (const [req, info] of requests.entries()) {
    console.log('---');
    console.log(info.method, info.url, info.status || 'pending', info.responseBody ? `${info.responseBody.slice(0,120)}...` : '');
  }

  await browser.close();
})();