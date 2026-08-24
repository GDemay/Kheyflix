import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, test } from "vitest";

const children: ChildProcess[] = [];
const servers: Server[] = [];

const listen = (server: Server) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    );
  });

const unusedPort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
};

const startTranscoder = async (appOrigin: string) => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["scripts/transcoder.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KHEYFLIX_APP_ORIGIN: appOrigin,
      KHEYFLIX_TRANSCODER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const endpoint = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Transcoder exited before readiness: ${stderr}`);
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // The child process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Transcoder did not become ready: ${stderr}`);
};

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
    });
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("transcoder dependency health", () => {
  test("proves the transcoder process can reach its configured app origin", async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const app = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url });
      response.writeHead(200).end();
    });
    servers.push(app);
    const appPort = await listen(app);

    await expect(
      startTranscoder(`http://127.0.0.1:${appPort}`),
    ).resolves.toMatchObject({ ok: true, appOrigin: true });
    expect(requests).toContainEqual({ method: "HEAD", url: "/" });
    expect(requests.some(({ url }) => url?.includes("/api/debrid/stream"))).toBe(false);
  });

  test("fails health when the transcoder process has a wrong app origin", async () => {
    const wrongPort = await unusedPort();

    await expect(
      startTranscoder(`http://127.0.0.1:${wrongPort}`),
    ).resolves.toMatchObject({ ok: false, appOrigin: false });
  });
});
