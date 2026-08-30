import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const host = "127.0.0.1";

// Vinext loads .env.local for the application process, but the companion
// transcoder is a separate Node process. Merge the same local runtime config
// before spawning either child, while allowing an explicit shell value to win.
// Values remain in process memory only and are never logged by this module.
export const loadLocalEnvironment = async (
  sourceEnv = process.env,
  envFile = ".env.local",
) => {
  try {
    const parsed = parseEnv(await readFile(envFile, "utf8"));
    return { ...parsed, ...sourceEnv };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return { ...sourceEnv };
    throw error;
  }
};

const canListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () =>
      server.close(() => resolve(true)),
    );
  });

export const findAvailablePort = async (startPort = 3101) => {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error("No free loopback port is available for the media service.");
};

export const isKheyflixTranscoder = (port) =>
  new Promise((resolve) => {
    const request = http.get(
      { host, port, path: "/health", timeout: 500 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        response.on("end", () => {
          try {
            const health = JSON.parse(body);
            resolve(
              response.statusCode === 200 &&
                health?.ok === true &&
                (health.service === "kheyflix-transcoder" ||
                  (Number.isFinite(health.jobs) &&
                    Number.isFinite(health.cachedBootstraps) &&
                    Number.isFinite(health.probes))),
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });

export const isKheyflixApp = (port) =>
  new Promise((resolve) => {
    const request = http.get(
      { hostname: "localhost", port, path: "/api/health", timeout: 3_000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        response.on("end", () => {
          try {
            const health = JSON.parse(body);
            resolve(
              response.statusCode === 200 &&
                (health?.status === "ok" || health?.status === "degraded") &&
                health?.dependencies?.transcoder === true,
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });

export const resolveDevEnvironment = async (
  sourceEnv = process.env,
  portProbe = findAvailablePort,
  defaultTranscoderPort = 3101,
  appProbe = isKheyflixApp,
) => {
  const appPort = sourceEnv.PORT || "3000";
  const explicitTranscoderPort = sourceEnv.KHEYFLIX_TRANSCODER_PORT;
  let transcoderPort = explicitTranscoderPort || String(defaultTranscoderPort);
  let startTranscoder = true;
  const startApp = !(await appProbe(Number(appPort)));

  if (!startApp) {
    startTranscoder = false;
  } else if (!explicitTranscoderPort) {
    if (await isKheyflixTranscoder(Number(transcoderPort))) {
      startTranscoder = false;
    } else {
      transcoderPort = String(await portProbe(Number(transcoderPort)));
    }
  }

  return {
    env: {
      ...sourceEnv,
      PORT: appPort,
      KHEYFLIX_APP_ORIGIN:
        sourceEnv.KHEYFLIX_APP_ORIGIN || `http://localhost:${appPort}`,
      // Kheyflix production is a Railway app plus a loopback transcoder, not
      // a Cloudflare Worker. Keep local development on that same topology so
      // playback tests can exercise the actual media service.
      KHEYFLIX_LOCAL_RUNTIME: sourceEnv.KHEYFLIX_LOCAL_RUNTIME || "railway",
      KHEYFLIX_TRANSCODER_PORT: transcoderPort,
      KHEYFLIX_TRANSCODER_URL:
        sourceEnv.KHEYFLIX_TRANSCODER_URL ||
        `http://${host}:${transcoderPort}`,
    },
    startApp,
    startTranscoder,
  };
};
