import { createServer } from "node:http";

function layout({ title, body, extraHead = "", script = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    ${extraHead}
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #171717; background: #fff; font: 16px/1.5 system-ui, sans-serif; }
      nav, main, footer { width: min(100% - 32px, 960px); margin-inline: auto; }
      nav { display: flex; gap: 16px; padding-block: 16px; }
      .hero { padding: 48px 0; }
      .spacer { height: 940px; }
      .cta { display: inline-block; padding: 12px 18px; background: #111; color: #fff; }
      .overflow { width: 900px; height: 10px; background: red; }
      label { display: block; margin-block: 12px; }
    </style>
  </head>
  <body>
    <nav aria-label="Primary">
      <a href="/">Home</a>
      <a href="/pricing">Pricing</a>
      <a href="/docs">Docs</a>
      <a href="/missing">Missing</a>
      <a href="https://example.org/ignored">External</a>
    </nav>
    <main>${body}</main>
    <footer>Fixture only</footer>
    ${script}
  </body>
</html>`;
}

function pageFor(path, mode) {
  const fixed = mode !== "broken";
  const regression = mode === "regression";
  if (path === "/") {
    return {
      status: 200,
      html: layout({
        title: "Fixture landing",
        body: `<section class="hero">
          <h1>Ship a landing that works</h1>
          ${fixed ? '<a class="cta" data-yls-primary-cta href="/pricing">Get started</a>' : ""}
          ${fixed ? "" : '<img src="/pixel.svg"><div class="spacer"></div><a class="cta" data-yls-primary-cta href="/pricing">Get started</a>'}
          ${regression ? '<div class="overflow" aria-hidden="true"></div>' : ""}
        </section>`,
        script: fixed ? "" : '<script>console.error("seeded fixture console error"); fetch("/submit", { method: "POST", body: "must-be-blocked" });</script>',
      }),
    };
  }
  if (path === "/pricing") {
    return {
      status: 200,
      html: layout({
        title: "Pricing",
        body: `<h1>Pricing</h1>
          <form method="post" action="/submit">
            ${fixed ? '<label>Email <input name="email" type="email"></label>' : '<input name="email" type="email">'}
            <button type="submit">Start</button>
          </form>`,
      }),
    };
  }
  if (path === "/docs") {
    return {
      status: 200,
      html: layout({
        title: "Documentation",
        body: fixed ? "<h1>Documentation</h1><p>Read the integration guide.</p>" : "<p>Read the integration guide.</p>",
      }),
    };
  }
  if (path === "/missing") {
    return fixed
      ? { status: 200, html: layout({ title: "Recovered route", body: "<h1>Recovered route</h1>" }) }
      : { status: 404, html: layout({ title: "Not found", body: "<h1>Not found</h1>" }) };
  }
  if (path === "/private") {
    return { status: 200, html: layout({ title: "Private", body: "<h1>Robots excluded</h1>" }) };
  }
  if (path === "/admin/secret") {
    return { status: 200, html: layout({ title: "Admin", body: "<h1>Mask excluded</h1>" }) };
  }
  return { status: 404, html: layout({ title: "Not found", body: "<h1>Not found</h1>" }) };
}

export async function startFixtureServer({ mode = "broken" } = {}) {
  const state = { submissions: 0, requests: [] };
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);
    state.requests.push(`${request.method} ${url.pathname}`);

    if (url.pathname === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset>
        <url><loc>${origin}/</loc></url>
        <url><loc>${origin}/pricing</loc></url>
        <url><loc>${origin}/docs</loc></url>
        <url><loc>${origin}/private</loc></url>
        <url><loc>${origin}/admin/secret</loc></url>
      </urlset>`);
      return;
    }
    if (url.pathname === "/pixel.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
      return;
    }
    if (url.pathname === "/submit" && request.method === "POST") {
      state.submissions += 1;
      for await (const _chunk of request) {
        // Drain the request without retaining submitted data.
      }
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/__state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }
    const page = pageFor(url.pathname, mode);
    response.writeHead(page.status, { "content-type": "text/html; charset=utf-8" });
    response.end(page.html);
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise()))),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const fixture = await startFixtureServer({ mode: process.argv[2] ?? "broken" });
  process.stdout.write(`${fixture.url}\n`);
}
