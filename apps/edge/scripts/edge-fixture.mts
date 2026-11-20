import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

export const artifactDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

/** Each case controls its own endpoint, including when the origin sends headers or EOF. */
export async function startOrigin(t: TestContext) {
  const routes = new Map<string, RequestListener>();
  const unexpectedRequests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url!;
    const handler = routes.get(path);
    if (handler) return handler(request, response);
    unexpectedRequests.push(path);
    response.writeHead(500).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
    assert.deepEqual(unexpectedRequests, [], "An unregistered route reached the origin");
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    on(path: string, handler: RequestListener) {
      assert.ok(!routes.has(path), `Duplicate test route ${path}`);
      routes.set(path, handler);
    },
  };
}
