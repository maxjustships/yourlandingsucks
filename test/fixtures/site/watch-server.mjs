import { createServer } from "node:http";

function document({ title, h1, extra }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${h1}</h1>${extra ? '<a href="/extra">Extra page</a>' : ""}</main></body></html>`;
}

export async function startWatchFixture({ name = "Site" } = {}) {
  const state = { title: `${name} title`, h1: `${name} heading`, status: 200, extra: false, requests: 0 };
  const server = createServer((request, response) => {
    state.requests += 1;
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url>${state.extra ? `<url><loc>${origin}/extra</loc></url>` : ""}</urlset>`);
      return;
    }
    if (url.pathname === "/" || (url.pathname === "/extra" && state.extra)) {
      response.writeHead(url.pathname === "/" ? state.status : 200, { "content-type": "text/html; charset=utf-8" });
      response.end(document({
        title: url.pathname === "/" ? state.title : `${name} extra`,
        h1: url.pathname === "/" ? state.h1 : `${name} extra heading`,
        extra: state.extra && url.pathname === "/",
      }));
      return;
    }
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(document({ title: "Missing", h1: "Missing", extra: false }));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Watch fixture failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    update(values) { Object.assign(state, values); },
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  };
}
