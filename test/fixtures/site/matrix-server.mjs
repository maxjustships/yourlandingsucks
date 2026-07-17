import { createServer } from "node:http";

function html(body, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discovery fixture</title></head><body><main><h1>Discovery fixture</h1>${body}</main>${script}</body></html>`;
}

function listen(server) {
  return new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
}

function close(server) {
  return new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

export async function startDiscoveryMatrixServer() {
  const external = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html("<p>Different origin. It must not be inspected.</p>"));
  });
  await listen(external);
  const externalAddress = external.address();
  if (!externalAddress || typeof externalAddress === "string") throw new Error("External fixture failed to bind");
  const externalUrl = `http://127.0.0.1:${externalAddress.port}`;

  const state = { externalRequests: 0 };
  external.on("request", () => { state.externalRequests += 1; });

  const server = createServer((request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /robots-hidden\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap></sitemapindex>`);
      return;
    }
    if (url.pathname === "/sitemap-pages.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset>
        <url><loc>${origin}/from-sitemap?campaign=one</loc></url>
        <url><loc>${origin}/redirect-external</loc></url>
        <url><loc>${origin}/robots-hidden</loc></url>
        <url><loc>${origin}/admin/hidden</loc></url>
      </urlset>`);
      return;
    }
    if (url.pathname === "/redirect-external") {
      response.writeHead(302, { location: `${externalUrl}/destination` });
      response.end();
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html(
        '<a href="/level-one">Level one</a>',
        '<script>setTimeout(() => { document.querySelector("main").insertAdjacentHTML("beforeend", \'<a href="/spa?variant=a">SPA A</a><a href="/spa?variant=b">SPA B</a>\'); }, 80);</script>',
      ));
      return;
    }
    if (url.pathname === "/level-one") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html('<a href="/level-two">Level two</a>'));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html(`<p>${url.pathname}</p>`));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Discovery fixture failed to bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    externalUrl,
    state,
    close: () => Promise.all([close(server), close(external)]),
  };
}
