import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  isKheyflixApp,
  loadLocalEnvironment,
  resolveDevEnvironment,
} from "./run-dev-support.mjs";

type PortProbe = (startPort?: number) => Promise<number>;

const servers: ReturnType<typeof createServer>[] = [];
const sockets = new Set<import("node:net").Socket>();
const directories: string[] = [];

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const occupy = async (port = 0) => {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return (server.address() as { port: number }).port;
};

const serveHealthyTranscoder = async (port = 0) => {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" +
        JSON.stringify({
          ok: true,
          service: "kheyflix-transcoder",
          jobs: 0,
          cachedBootstraps: 0,
          probes: 0,
        }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return (server.address() as { port: number }).port;
};

const serveAppHealth = async (
  status: "ok" | "degraded",
  port = 0,
  delay = 0,
) => {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    setTimeout(
      () =>
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" +
            JSON.stringify({ status, dependencies: { transcoder: true } }),
        ),
      delay,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "::1", resolve);
  });
  return (server.address() as { port: number }).port;
};

describe("development process environment", () => {
  test("passes local runtime configuration to both app and transcoder children", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-local-env-"));
    directories.push(directory);
    const envFile = join(directory, ".env.local");
    await writeFile(
      envFile,
      "KHEYFLIX_INTERNAL_TRANSCODER_TOKEN=from-local-file\nPROWLARR_URL=http://prowlarr.railway.internal:9696\n",
      { mode: 0o600 },
    );

    const environment = await loadLocalEnvironment(
      { KHEYFLIX_INTERNAL_TRANSCODER_TOKEN: "explicit-shell-value" },
      envFile,
    );

    expect(environment.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN).toBe(
      "explicit-shell-value",
    );
    expect(environment.PROWLARR_URL).toBe(
      "http://prowlarr.railway.internal:9696",
    );
  });

  test("does not start a duplicate when the Kheyflix app is already healthy", async () => {
    const appProbe = async () => true;

    const result = await resolveDevEnvironment({}, undefined, 3101, appProbe);

    expect(result.startApp).toBe(false);
    expect(result.env.PORT).toBe("3000");
    expect(result.env.KHEYFLIX_LOCAL_RUNTIME).toBe("railway");
  });

  test("recognizes a running Kheyflix app whose optional discovery service is degraded", async () => {
    const appPort = await serveAppHealth("degraded", 0, 1_000);

    await expect(isKheyflixApp(appPort)).resolves.toBe(true);
  });

  test("reuses a healthy Kheyflix transcoder on the default port", async () => {
    const defaultPort = await serveHealthyTranscoder();

    const result = await resolveDevEnvironment(
      {},
      undefined,
      defaultPort,
      async () => false,
    );

    expect(result.env.KHEYFLIX_TRANSCODER_PORT).toBe(String(defaultPort));
    expect(result.startTranscoder).toBe(false);
  });

  test("keeps the app on 3000 and skips an occupied default transcoder port", async () => {
    const defaultPort = await occupy();

    const { env, startTranscoder } = await resolveDevEnvironment(
      {},
      undefined,
      defaultPort,
      async () => false,
    );

    expect(startTranscoder).toBe(true);
    expect(env.PORT).toBe("3000");
    expect(env.KHEYFLIX_LOCAL_RUNTIME).toBe("railway");
    expect(env.KHEYFLIX_APP_ORIGIN).toBe("http://localhost:3000");
    expect(env.KHEYFLIX_TRANSCODER_PORT).not.toBe(String(defaultPort));
    expect(env.KHEYFLIX_TRANSCODER_URL).toBe(
      `http://127.0.0.1:${env.KHEYFLIX_TRANSCODER_PORT}`,
    );
  });

  test("preserves an explicitly configured transcoder port", async () => {
    const probe: PortProbe = async () => {
      throw new Error("automatic port selection should not run");
    };

    const { env, startTranscoder } = await resolveDevEnvironment(
      { PORT: "4000", KHEYFLIX_TRANSCODER_PORT: "4567" },
      probe,
      3101,
      async () => false,
    );

    expect(env.PORT).toBe("4000");
    expect(startTranscoder).toBe(true);
    expect(env.KHEYFLIX_TRANSCODER_PORT).toBe("4567");
    expect(env.KHEYFLIX_TRANSCODER_URL).toBe("http://127.0.0.1:4567");
  });
});
