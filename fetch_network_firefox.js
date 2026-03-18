// fetch_network_firefox.js

const fs = require('fs');
const { firefox } = require('playwright'); // playright must be installed
const path = require('path');

const outDir = path.join(__dirname, 'test-results', 'nested'); // folder inside project
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const aggregatedJsonPath = path.join(outDir, 'network_log.json');

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

      console.log(`RESPONSE <- ${response.status()} ${response.url()}`);
    } catch (err) {
      console.warn('Error handling response:', err);
    }
  });

  // Optional: capture failed requests
  page.on('requestfailed', request => {
    console.log(`FAILED   -> ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
  });

  // Navigate to a page (change to your target)
  await page.goto('https://bgaming.com/games/classic-multihand-blackjack', { waitUntil: 'networkidle' });

  // Wait or interact as needed so background requests occur
  await page.waitForTimeout(100000);

  // Inspect collected requests
  for (const [req, info] of requests.entries()) {
    console.log('---');
    console.log(info.method, info.url, info.status || 'pending', info.responseBody ? `${info.responseBody.slice(0,120)}...` : '');
  }

  // Persist entire network trace to a single JSON file.
  const serializedRequests = Array.from(requests.values()).map(entry => ({
    id: entry.id,
    url: entry.url,
    method: entry.method,
    headers: entry.headers,
    postData: entry.postData,
    startTime: entry.startTime,
    status: entry.status,
    statusText: entry.statusText,
    responseHeaders: entry.responseHeaders,
    responseBodyIsBase64: entry.responseBodyIsBase64,
    responseBody: entry.responseBody,
    endTime: entry.endTime
  }));
  fs.writeFileSync(aggregatedJsonPath, JSON.stringify(serializedRequests, null, 2));
  console.log(`Saved network log to ${aggregatedJsonPath}`);

  await browser.close();
})();