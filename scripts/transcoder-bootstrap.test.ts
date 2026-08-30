import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const children: ChildProcess[] = [];
const servers: Server[] = [];
const directories: string[] = [];
const diagnostics = new Map<string, { stderr: string }>();

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForPath = async (path: string, timeout = 5_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await stat(path);
    } catch {
      await wait(25);
    }
  }
  return stat(path);
};

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

const executable = async (directory: string, name: string, source: string) => {
  const path = join(directory, name);
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
};

const delayedInheritedPipeChild = (
  marker: string,
  delay: number,
  escaped = false,
) =>
  `const { spawn } = require('node:child_process');
const marker = ${JSON.stringify(marker)};
const delay = ${String(delay)};
const worker =
  "const { writeFileSync } = require('node:fs');" +
  "const parentPid = " + process.pid + ";" +
  "const marker = " + JSON.stringify(marker) + ";" +
  "const delay = " + delay + ";" +
  "const waitForParentExit = () => {" +
    "try { process.kill(parentPid, 0); setTimeout(waitForParentExit, 10); }" +
    "catch { setTimeout(() => { writeFileSync(marker, 'closed'); process.exit(0); }, delay); }" +
  "}; waitForParentExit();";
const descendant = spawn(process.execPath, ['-e', worker], {
  stdio: 'inherit',
  ${escaped ? "detached: true," : ""}
});
${escaped ? "descendant.unref();" : ""}`;

const startTranscoder = async (
  appOrigin: string,
  ffmpeg: string,
  ffprobe: string,
  extraEnv: Record<string, string> = {},
) => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["scripts/transcoder.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KHEYFLIX_APP_ORIGIN: appOrigin,
      KHEYFLIX_FFMPEG_PATH: ffmpeg,
      KHEYFLIX_FFPROBE_PATH: ffprobe,
      KHEYFLIX_TRANSCODER_PORT: String(port),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const diagnostic = { stderr: "" };
  child.stderr?.on("data", (chunk) => {
    diagnostic.stderr += String(chunk);
  });
  const endpoint = `http://127.0.0.1:${port}`;
  diagnostics.set(endpoint, diagnostic);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Transcoder exited before readiness: ${diagnostic.stderr}`);
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) return endpoint;
    } catch {
      // The child process has not started listening yet.
    }
    await wait(25);
  }
  throw new Error(`Transcoder did not become ready: ${diagnostic.stderr}`);
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
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  diagnostics.clear();
});

describe("bootstrap transcoder lifecycle", () => {
  test("starts bootstrap bytes without waiting for a full media probe", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nif (!process.argv.includes('-t') || !process.argv.includes('30')) { process.stderr.write('bootstrap duration missing'); process.exit(92); } if (!process.argv.includes('scale=-2:360')) { process.stderr.write('bootstrap profile height missing'); process.exit(93); } process.stdout.write('bootstrap-bytes'); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const response = await fetch(
      `${endpoint}/transcode/42/0?token=bootstrap-one&quality=bootstrap`,
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    expect(new TextDecoder().decode(firstChunk?.value)).toContain("bootstrap-bytes");
    await reader?.cancel();
  }, 15_000);

  test("yields a concurrent metadata probe until bootstrap bytes are available", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const probeStarted = join(directory, "probe-started");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nsetTimeout(() => process.stdout.write('bootstrap-bytes'), 900); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(probeStarted)}, 'started'); process.stdout.write(JSON.stringify({format:{duration:'120',format_name:'matroska'},streams:[]}));\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const bootstrap = fetch(
      `${endpoint}/transcode/42/0?token=probe-priority&quality=bootstrap`,
    );
    await wait(120);
    const metadata = fetch(`${endpoint}/probe/42/0`);
    await wait(450);
    await expect(stat(probeStarted)).rejects.toThrow();

    const bootstrapResponse = await bootstrap;
    expect(bootstrapResponse.status).toBe(200);
    await bootstrapResponse.body?.getReader().cancel();
    const metadataResponse = await metadata;
    expect(metadataResponse.status).toBe(200);
    await expect(stat(probeStarted)).resolves.toBeDefined();
  }, 15_000);

  test("keeps the replacement job accounted when a duplicated session is superseded", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const first = await fetch(
      `${endpoint}/transcode/42/0?token=reused-token&quality=bootstrap`,
    );
    await first.body?.getReader().read();
    const second = await fetch(
      `${endpoint}/transcode/42/0?token=reused-token&quality=bootstrap`,
    );
    await second.body?.getReader().read();
    await wait(100);

    const health = await (await fetch(`${endpoint}/health`)).json();

    expect(health.jobs).toBe(1);
  }, 15_000);

  test("does not evict active bootstrap playback when the two-slot service is full", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
      { KHEYFLIX_MAX_JOBS: "Infinity" },
    );

    const first = await fetch(`${endpoint}/transcode/42/0?token=bootstrap-one&quality=bootstrap`);
    const second = await fetch(`${endpoint}/transcode/42/0?token=bootstrap-two&quality=bootstrap`);
    const firstReader = first.body?.getReader();
    const secondReader = second.body?.getReader();
    await firstReader?.read();
    await secondReader?.read();

    const rejected = await fetch(`${endpoint}/transcode/42/0?token=bootstrap-three&quality=bootstrap`);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("3");
    const healthAtCapacity = await (await fetch(`${endpoint}/health`)).json();
    expect(healthAtCapacity.jobs).toBe(2);
    expect(healthAtCapacity.capacity).toMatchObject({
      maxJobs: 2,
      inUse: 2,
      available: 0,
      atCapacity: true,
    });
    expect(healthAtCapacity.capacity.rejected).toBeGreaterThanOrEqual(1);

    await fetch(`${endpoint}/stop/bootstrap-one`, { method: "POST" });
    const admitted = await fetch(`${endpoint}/transcode/42/0?token=bootstrap-three&quality=bootstrap`);
    expect(admitted.status).toBe(200);
    await admitted.body?.getReader().read();
    await firstReader?.cancel();
    await secondReader?.cancel();
  }, 15_000);

  test("waits through the full explicit-stop contract before admitting its replacement", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const closeMarker = join(directory, "closing-child-finished");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(closeMarker, 2_200, true)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const first = await fetch(
      `${endpoint}/transcode/42/0?token=closing-bootstrap&quality=bootstrap`,
    );
    const second = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const firstReader = first.body?.getReader();
    const secondReader = second.body?.getReader();
    await firstReader?.read();
    await secondReader?.read();

    const stop = fetch(`${endpoint}/stop/closing-bootstrap`, { method: "POST" });
    const stopDeadline = Date.now() + 1_000;
    let stopping;
    while (Date.now() < stopDeadline) {
      stopping = await (await fetch(`${endpoint}/health`)).json();
      if (stopping.capacity.stopping === 1) break;
      await wait(25);
    }
    expect(stopping.capacity).toMatchObject({
      activeTranscodes: 1,
      inUse: 2,
      stopping: 1,
    });
    await expect(stat(closeMarker)).rejects.toThrow();

    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=next-bootstrap&quality=bootstrap`,
    );

    expect(replacement.status).toBe(200);
    await expect(waitForPath(closeMarker)).resolves.toBeDefined();
    const replacementReader = replacement.body?.getReader();
    await replacementReader?.read();
    expect((await stop).status).toBe(204);
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.capacity).toMatchObject({
      activeTranscodes: 2,
      rejected: 0,
      stopping: 0,
      stoppingWaits: 1,
      stoppingTimeouts: 0,
    });
    await replacementReader?.cancel();
    await firstReader?.cancel();
    await secondReader?.cancel();
  }, 15_000);

  test.skipIf(process.platform === "win32")(
    "stops descendants in the owned encoder process group before recycling capacity",
    async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const descendantMarker = join(directory, "owned-descendant-survived-stop");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(descendantMarker, 350)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const first = await fetch(
      `${endpoint}/transcode/42/0?token=group-bootstrap&quality=bootstrap`,
    );
    const second = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const firstReader = first.body?.getReader();
    const secondReader = second.body?.getReader();
    await firstReader?.read();
    await secondReader?.read();

    const stop = await fetch(`${endpoint}/stop/group-bootstrap`, { method: "POST" });
    expect(stop.status).toBe(204);

    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=group-replacement&quality=bootstrap`,
    );

    expect(replacement.status).toBe(200);
    const replacementReader = replacement.body?.getReader();
    await replacementReader?.read();
    await expect(stat(descendantMarker)).rejects.toThrow();
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.capacity).toMatchObject({
      activeTranscodes: 2,
      inUse: 2,
      stopping: 0,
    });
    await replacementReader?.cancel();
    await firstReader?.cancel();
    await secondReader?.cancel();
    },
    15_000,
  );

  test.skipIf(process.platform === "win32")(
    "kills an owned descendant after its encoder leader exits but before inherited pipes close",
    async () => {
      const app = createServer((_request, response) => response.writeHead(200).end());
      servers.push(app);
      const appPort = await listen(app);
      const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
      directories.push(directory);
      const leaderExitedMarker = join(directory, "leader-exited");
      const descendantMarker = join(directory, "leader-exited-descendant-survived");
      const ffmpeg = await executable(
        directory,
        "ffmpeg",
        `#!/usr/bin/env node\n${delayedInheritedPipeChild(descendantMarker, 350)}\nconst { writeFileSync } = require('node:fs'); process.stdout.write('stream-bytes'); setTimeout(() => { writeFileSync(${JSON.stringify(leaderExitedMarker)}, 'exited'); process.exit(0); }, 50);\n`,
      );
      const ffprobe = await executable(
        directory,
        "ffprobe",
        "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
      );
      const endpoint = await startTranscoder(
        `http://127.0.0.1:${appPort}`,
        ffmpeg,
        ffprobe,
      );

      const response = await fetch(
        `${endpoint}/transcode/42/0?token=leader-exited-bootstrap&quality=bootstrap`,
      );
      expect(response.status).toBe(200);
      await response.body?.getReader().read();
      await expect(waitForPath(leaderExitedMarker)).resolves.toBeDefined();
      await wait(75);

      const stopped = await fetch(`${endpoint}/stop/leader-exited-bootstrap`, {
        method: "POST",
      });
      expect(stopped.status).toBe(204);
      await wait(450);
      await expect(stat(descendantMarker)).rejects.toThrow();
      const health = await (await fetch(`${endpoint}/health`)).json();
      expect(health.capacity).toMatchObject({
        activeTranscodes: 0,
        stopping: 0,
        inUse: 0,
      });
    },
    15_000,
  );

  test("returns a retryable busy response when an escaped teardown exceeds the stop contract", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const closeMarker = join(directory, "long-closing-child-finished");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(closeMarker, 4_000, true)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const first = await fetch(
      `${endpoint}/transcode/42/0?token=long-closing-bootstrap&quality=bootstrap`,
    );
    const second = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const firstReader = first.body?.getReader();
    const secondReader = second.body?.getReader();
    await firstReader?.read();
    await secondReader?.read();

    const stop = fetch(`${endpoint}/stop/long-closing-bootstrap`, { method: "POST" });
    const stopDeadline = Date.now() + 1_000;
    let stopping;
    while (Date.now() < stopDeadline) {
      stopping = await (await fetch(`${endpoint}/health`)).json();
      if (stopping.capacity.stopping === 1) break;
      await wait(25);
    }
    expect(stopping.capacity.stopping).toBe(1);

    const duplicateStop = fetch(`${endpoint}/stop/long-closing-bootstrap`, {
      method: "POST",
    });
    await expect(
      Promise.race([
        duplicateStop.then(() => "completed"),
        wait(150).then(() => "pending"),
      ]),
    ).resolves.toBe("pending");

    const requestedAt = Date.now();
    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=timed-out-bootstrap&quality=bootstrap`,
    );

    expect(replacement.status).toBe(429);
    expect(replacement.headers.get("retry-after")).toBe("3");
    expect(Date.now() - requestedAt).toBeGreaterThanOrEqual(2_200);
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.capacity).toMatchObject({
      inUse: 2,
      rejected: 1,
      stopping: 1,
      stoppingWaits: 1,
      stoppingTimeouts: 1,
    });
    await expect(waitForPath(closeMarker)).resolves.toBeDefined();
    expect((await stop).status).toBe(202);
    expect((await duplicateStop).status).toBe(202);
    expect((await fetch(`${endpoint}/stop/long-closing-bootstrap`, {
      method: "POST",
    })).status).toBe(204);

    const admitted = await fetch(
      `${endpoint}/transcode/42/0?token=after-timeout-bootstrap&quality=bootstrap`,
    );
    expect(admitted.status).toBe(200);
    await admitted.body?.getReader().cancel();
    await firstReader?.cancel();
    await secondReader?.cancel();
  }, 15_000);

  test("waits through the full stop contract when reclaiming an abandoned session", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const closeMarker = join(directory, "abandoned-closing-child-finished");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(closeMarker, 2_200, true)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
      { KHEYFLIX_ABANDONED_PLAYBACK_TTL_MS: "25" },
    );

    const abandoned = await fetch(
      `${endpoint}/transcode/42/0?token=abandoned-bootstrap&quality=bootstrap`,
    );
    const active = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const abandonedReader = abandoned.body?.getReader();
    const activeReader = active.body?.getReader();
    await abandonedReader?.read();
    await activeReader?.read();
    await wait(80);
    await fetch(`${endpoint}/touch/active-bootstrap`, { method: "POST" });

    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=replacement-bootstrap&quality=bootstrap`,
    );

    expect(replacement.status).toBe(200);
    await expect(waitForPath(closeMarker)).resolves.toBeDefined();
    const replacementReader = replacement.body?.getReader();
    await replacementReader?.read();
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.capacity).toMatchObject({
      activeTranscodes: 2,
      rejected: 0,
      reclaimed: 1,
      reclaimedWaits: 1,
      reclaimedTimeouts: 0,
    });
    await replacementReader?.cancel();
    await abandonedReader?.cancel();
    await activeReader?.cancel();
  }, 15_000);

  test("does not let an aborted queued startup consume a reclaimed slot", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const probeStarted = join(directory, "probe-started");
    const escapedCloseMarker = join(directory, "aborted-queue-closing-child-finished");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(escapedCloseMarker, 2_000, true)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nconst { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(probeStarted)}, 'started'); setTimeout(() => { process.stdout.write(JSON.stringify({format:{duration:'120',format_name:'mov,mp4,m4a,3gp,3g2,mj2'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:1280,height:720},{index:1,codec_type:'audio',codec_name:'aac',channels:2}]})); process.exit(0); }, 1000);\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
      { KHEYFLIX_ABANDONED_PLAYBACK_TTL_MS: "1000" },
    );

    const abandoned = await fetch(
      `${endpoint}/transcode/42/0?token=abandoned-bootstrap&quality=bootstrap`,
    );
    const active = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const abandonedReader = abandoned.body?.getReader();
    const activeReader = active.body?.getReader();
    await abandonedReader?.read();
    await activeReader?.read();
    await wait(1_100);
    await fetch(`${endpoint}/touch/active-bootstrap`, { method: "POST" });

    const controller = new AbortController();
    const abandonedStartup = fetch(
      `${endpoint}/transcode/42/0?token=aborted-original&quality=original`,
      { signal: controller.signal },
    ).catch(() => undefined);
    const stopDeadline = Date.now() + 1_000;
    let stopping;
    while (Date.now() < stopDeadline) {
      stopping = await (await fetch(`${endpoint}/health`)).json();
      if (stopping.capacity.stopping === 1) break;
      await wait(25);
    }
    expect(stopping.capacity.stopping).toBe(1);
    controller.abort();
    await wait(100);

    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=replacement-bootstrap&quality=bootstrap`,
    );

    expect(replacement.status).toBe(200);
    await replacement.body?.getReader().cancel();
    await abandonedStartup;
    await expect(stat(probeStarted)).rejects.toThrow();
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.capacity).toMatchObject({ rejected: 0, pending: 0 });
    await abandonedReader?.cancel();
    await activeReader?.cancel();
  }, 15_000);

  test("honors an explicit stop while a startup is queued behind reclamation", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const probeStarted = join(directory, "probe-started");
    const escapedCloseMarker = join(directory, "stopped-queue-closing-child-finished");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(escapedCloseMarker, 2_000, true)}\nprocess.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nconst { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(probeStarted)}, 'started'); setTimeout(() => { process.stdout.write(JSON.stringify({format:{duration:'120',format_name:'mov,mp4,m4a,3gp,3g2,mj2'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:1280,height:720},{index:1,codec_type:'audio',codec_name:'aac',channels:2}]})); process.exit(0); }, 1000);\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
      { KHEYFLIX_ABANDONED_PLAYBACK_TTL_MS: "1000" },
    );

    const abandoned = await fetch(
      `${endpoint}/transcode/42/0?token=abandoned-bootstrap&quality=bootstrap`,
    );
    const active = await fetch(
      `${endpoint}/transcode/42/0?token=active-bootstrap&quality=bootstrap`,
    );
    const abandonedReader = abandoned.body?.getReader();
    const activeReader = active.body?.getReader();
    await abandonedReader?.read();
    await activeReader?.read();
    await wait(1_100);
    await fetch(`${endpoint}/touch/active-bootstrap`, { method: "POST" });

    const controller = new AbortController();
    const queuedStartup = fetch(
      `${endpoint}/transcode/42/0?token=stopped-original&quality=original`,
      { signal: controller.signal },
    ).catch(() => undefined);
    const stopDeadline = Date.now() + 1_000;
    let stopping;
    while (Date.now() < stopDeadline) {
      stopping = await (await fetch(`${endpoint}/health`)).json();
      if (stopping.capacity.stopping === 1) break;
      await wait(25);
    }
    expect(stopping.capacity.stopping).toBe(1);

    const stopped = await fetch(`${endpoint}/stop/stopped-original`, {
      method: "POST",
    });
    expect(stopped.status).toBe(204);

    const reclamationDeadline = Date.now() + 4_000;
    let released;
    while (Date.now() < reclamationDeadline) {
      released = await (await fetch(`${endpoint}/health`)).json();
      if (
        released.capacity.stopping === 0 &&
        released.capacity.pending === 0
      )
        break;
      await wait(25);
    }
    expect(released.capacity).toMatchObject({ stopping: 0, pending: 0 });
    await expect(stat(probeStarted)).rejects.toThrow();
    controller.abort();
    await queuedStartup;
    await abandonedReader?.cancel();
    await activeReader?.cancel();
  }, 15_000);

  test("admits a replacement when another capacity slot closes during a pending stop", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const closeMarker = join(directory, "escaped-transcode-close-finished"),
      probePayload = JSON.stringify({
        format: { duration: "120", format_name: "matroska" },
        streams: [{ index: 2, codec_type: "subtitle", codec_name: "subrip" }],
      });
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      [
        "#!/usr/bin/env node",
        "if (process.argv.includes('webvtt')) { process.stdout.write('WEBVTT\\n\\n00:00:00.000 --> 00:00:01.000\\ntext\\n\\n'); setTimeout(() => process.exit(0), 1400); } else {",
        delayedInheritedPipeChild(closeMarker, 4_000, true),
        "process.stdout.write('stream-bytes'); setInterval(() => {}, 1000);",
        "}",
      ].join("\n"),
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stdout.write(" +
        JSON.stringify(probePayload) +
        "); process.exit(0);",
    );
    const endpoint = await startTranscoder(
      "http://127.0.0.1:" + appPort,
      ffmpeg,
      ffprobe,
    );

    const subtitle = await fetch(endpoint + "/subtitle/42/0/2.vtt");
    await subtitle.body?.getReader().read();
    const subtitleDeadline = Date.now() + 1_000;
    let subtitleActive = false;
    while (Date.now() < subtitleDeadline) {
      const health = await (await fetch(endpoint + "/health")).json();
      if (health.capacity.activeSubtitles === 1) {
        subtitleActive = true;
        break;
      }
      await wait(25);
    }
    expect(subtitleActive).toBe(true);

    const first = await fetch(
      endpoint + "/transcode/42/0?token=closing-with-subtitle&quality=bootstrap",
    );
    const firstReader = first.body?.getReader();
    await firstReader?.read();
    const stop = fetch(endpoint + "/stop/closing-with-subtitle", { method: "POST" });
    const stopDeadline = Date.now() + 1_000;
    let stopping = false;
    while (Date.now() < stopDeadline) {
      const health = await (await fetch(endpoint + "/health")).json();
      if (health.capacity.stopping === 1) {
        stopping = true;
        break;
      }
      await wait(25);
    }
    expect(stopping).toBe(true);

    const requestedAt = Date.now();
    const replacement = await fetch(
      endpoint + "/transcode/42/0?token=subtitle-freed-replacement&quality=bootstrap",
    );

    expect(replacement.status).toBe(200);
    expect(Date.now() - requestedAt).toBeLessThan(2_000);
    const health = await (await fetch(endpoint + "/health")).json();
    expect(health.capacity).toMatchObject({
      activeSubtitles: 0,
      activeTranscodes: 1,
      inUse: 2,
      stopping: 1,
      stoppingWaits: 1,
      stoppingTimeouts: 0,
    });
    await replacement.body?.getReader().cancel();
    await firstReader?.cancel();
    expect((await stop).status).toBe(202);
    await expect(waitForPath(closeMarker)).resolves.toBeDefined();
  }, 15_000);

  test("starts fixed-profile iPhone HLS without waiting for a media probe", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const descendantMarker = join(directory, "hls-descendant-survived-stop");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\n${delayedInheritedPipeChild(descendantMarker, 350)}\nconst { dirname, join } = require('node:path'); const { mkdirSync, writeFileSync } = require('node:fs'); const output = process.argv.at(-1); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\\n#EXTINF:1.5,\\nsegment00000.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:01.500Z\\n#EXTINF:1.5,\\nsegment00001.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:03.000Z\\n#EXTINF:1.5,\\nsegment00002.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:04.500Z\\n#EXTINF:1.5,\\nsegment00003.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:06.000Z\\n#EXTINF:1.5,\\nsegment00004.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:07.500Z\\n#EXTINF:1.5,\\nsegment00005.ts\\n'); for (const index of [0,1,2,3,4,5]) writeFileSync(join(dirname(output), 'segment0000' + index + '.ts'), 'segment'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const playlist = await fetch(`${endpoint}/hls/42/0/ios-480/master.m3u8?quality=480`);

    expect(playlist.status).toBe(200);
    const playlistBody = await playlist.text();
    expect(playlistBody).toContain("#EXTM3U");
    expect(playlistBody.match(/#EXT-X-PROGRAM-DATE-TIME:/g)).toHaveLength(6);
    expect((playlistBody.match(/#EXTINF:/g) || [])).toHaveLength(6);
    const segment = await fetch(`${endpoint}/hls/42/0/ios-480/segment00000.ts`);
    expect(segment.status).toBe(200);
    await expect(segment.text()).resolves.toBe("segment");
    const stopped = await fetch(`${endpoint}/stop/ios-480`, { method: "POST" });
    expect(stopped.status).toBe(204);
    await expect(stat(descendantMarker)).rejects.toThrow();
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.hls).toMatchObject({
      mastersRequested: 1,
      mastersDelivered: 1,
      segmentsRequested: 1,
      segmentsDelivered: 1,
    });
  }, 15_000);

  test("does not retain a signal-terminated HLS encoder as a closing capacity slot", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const signalMarker = join(directory, "hls-self-signalled");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      [
        "#!/usr/bin/env node",
        "const { dirname, join } = require('node:path');",
        "const { mkdirSync, writeFileSync } = require('node:fs');",
        "if (process.argv.includes('hls')) {",
        "  const output = process.argv.at(-1);",
        "  mkdirSync(dirname(output), { recursive: true });",
        "  writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:1\\n#EXTINF:0.75,\\nsegment00000.ts\\n');",
        "  writeFileSync(join(dirname(output), 'segment00000.ts'), 'segment');",
        "  setTimeout(() => { writeFileSync(" +
          JSON.stringify(signalMarker) +
          ", 'sent'); process.kill(process.pid, 'SIGKILL'); }, 350);",
        "} else {",
        "  process.stdout.write('stream-bytes');",
        "  setInterval(() => {}, 1000);",
        "}",
      ].join("\n"),
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const playlist = await fetch(
      `${endpoint}/hls/42/0/signalled-bootstrap/master.m3u8?quality=bootstrap`,
    );
    expect(playlist.status).toBe(200);
    await expect(playlist.text()).resolves.toContain("#EXTM3U");
    await expect(waitForPath(signalMarker)).resolves.toBeDefined();
    await wait(150);

    const afterSignal = await (await fetch(`${endpoint}/health`)).json();
    expect(afterSignal.capacity).toMatchObject({
      activeHls: 0,
      stopping: 0,
      inUse: 0,
    });

    const stoppedAt = Date.now();
    const stopped = await fetch(`${endpoint}/stop/signalled-bootstrap`, {
      method: "POST",
    });
    expect(stopped.status).toBe(204);
    expect(Date.now() - stoppedAt).toBeLessThan(1_000);
    const replacement = await fetch(
      `${endpoint}/transcode/42/0?token=signal-replacement&quality=bootstrap`,
    );
    expect(replacement.status).toBe(200);
    await replacement.body?.getReader().cancel();
  }, 15_000);

  test("serves a complete bounded native-VOD chunk for a nonzero Safari resume", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nconst { dirname, join } = require('node:path'); const { mkdirSync, writeFileSync } = require('node:fs'); const args = process.argv.slice(2); const at = (name) => args[args.indexOf(name) + 1]; const output = args.at(-1); const expectedDuration = output.includes('vod-warm') ? '30' : '15'; if (at('-t') !== expectedDuration || at('-hls_playlist_type') !== 'vod' || args.includes('-readrate') || args.includes('-hls_segment_type') || !args.includes('libx264') || !args.includes('aac')) process.exit(92); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PLAYLIST-TYPE:VOD\\n#EXT-X-INDEPENDENT-SEGMENTS\\n#EXTINF:1.5,\\nsegment00000.ts\\n#EXT-X-ENDLIST\\n'); writeFileSync(join(dirname(output), 'segment00000.ts'), 'segment'); process.exit(0);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const playlist = await fetch(
      `${endpoint}/hls/42/0/vod-resume/master.m3u8?start=200&quality=480&mode=native-vod`,
    );

    expect(playlist.status).toBe(200);
    const body = await playlist.text();
    expect(body).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(body).toContain("#EXT-X-ENDLIST");
    expect(body).not.toContain("#EXT-X-PROGRAM-DATE-TIME");
    const segment = await fetch(
      `${endpoint}/hls/42/0/vod-resume/segment00000.ts`,
    );
    expect(segment.status).toBe(200);
    await expect(segment.text()).resolves.toBe("segment");
    const warmedPlaylist = await fetch(
      `${endpoint}/hls/42/0/vod-warm/master.m3u8?start=215&quality=480&mode=native-vod-warm`,
    );
    expect(warmedPlaylist.status).toBe(200);
    await expect(warmedPlaylist.text()).resolves.toContain("#EXT-X-ENDLIST");
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.hls).toMatchObject({
      nativeVodChunksStarted: 2,
      nativeVodChunksCompleted: 2,
      nativeVodWarmChunksStarted: 1,
      nativeVodWarmChunksCompleted: 1,
    });
  }, 15_000);

  test("withholds a native-VOD manifest until FFmpeg closes the immutable playlist", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nconst { appendFileSync, mkdirSync, writeFileSync } = require('node:fs'); const { dirname, join } = require('node:path'); const output = process.argv.at(-1); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PLAYLIST-TYPE:VOD\\n#EXTINF:1.5,\\nsegment00000.ts\\n'); writeFileSync(join(dirname(output), 'segment00000.ts'), 'segment'); setTimeout(() => { appendFileSync(output, '#EXT-X-ENDLIST\\n'); process.exit(0); }, 350);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );
    const startedAt = Date.now();

    const response = await fetch(
      `${endpoint}/hls/42/0/vod-complete/master.m3u8?quality=480&mode=native-vod`,
    );

    expect(response.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    await expect(response.text()).resolves.toContain("#EXT-X-ENDLIST");
  }, 15_000);

  test("bounds delivered event-HLS segment storage without changing its manifest semantics", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const session = "event-prune";
    const hlsDirectory = join(tmpdir(), `kheyflix-hls-${session}`);
    directories.push(hlsDirectory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nconst { dirname, join } = require('node:path'); const { mkdirSync, writeFileSync } = require('node:fs'); const output = process.argv.at(-1); mkdirSync(dirname(output), { recursive: true }); let playlist = '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PLAYLIST-TYPE:EVENT\\n#EXT-X-INDEPENDENT-SEGMENTS\\n'; for (let index = 0; index <= 321; index += 1) { const suffix = String(index).padStart(5, '0'); playlist += '#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\\n#EXTINF:1.5,\\nsegment' + suffix + '.ts\\n'; writeFileSync(join(dirname(output), 'segment' + suffix + '.ts'), 'segment'); } writeFileSync(output, playlist); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const playlist = await fetch(
      `${endpoint}/hls/42/0/${session}/master.m3u8?quality=480`,
    );
    expect(playlist.status).toBe(200);
    await expect(playlist.text()).resolves.toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
    const segment = await fetch(
      `${endpoint}/hls/42/0/${session}/segment00321.ts`,
    );
    expect(segment.status).toBe(200);
    await expect(segment.text()).resolves.toBe("segment");
    await wait(100);

    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health.hls.eventSegmentsPruned).toBeGreaterThan(0);
    await expect(stat(join(hlsDirectory, "segment00000.ts"))).rejects.toThrow();
    await expect(stat(join(hlsDirectory, "segment00001.ts"))).resolves.toBeDefined();
  }, 15_000);

  test("releases a native HLS startup when its master request disconnects", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );
    const controller = new AbortController();
    const master = fetch(
      `${endpoint}/hls/42/0/early-disconnect/master.m3u8?quality=480`,
      { signal: controller.signal },
    ).catch(() => undefined);

    const startupDeadline = Date.now() + 5_000;
    let starting;
    while (Date.now() < startupDeadline) {
      starting = await (await fetch(`${endpoint}/health`)).json();
      if (starting.capacity.activeHls === 1) break;
      await wait(50);
    }
    expect(starting.capacity).toMatchObject({ activeHls: 1, pending: 0 });

    controller.abort();
    await master;
    const cleanupDeadline = Date.now() + 5_000;
    let cleared;
    while (Date.now() < cleanupDeadline) {
      cleared = await (await fetch(`${endpoint}/health`)).json();
      if (cleared.capacity.activeHls === 0 && cleared.capacity.pending === 0) break;
      await wait(50);
    }
    expect(cleared.capacity).toMatchObject({ activeHls: 0, pending: 0 });
  }, 15_000);

  test("yields a concurrent metadata probe until native HLS has a usable playlist", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const probeStarted = join(directory, "probe-started");
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nconst { dirname, join } = require('node:path'); const { mkdirSync, writeFileSync } = require('node:fs'); const output = process.argv.at(-1); setTimeout(() => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\\n#EXTINF:1.5,\\nsegment00000.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:01.500Z\\n#EXTINF:1.5,\\nsegment00001.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:03.000Z\\n#EXTINF:1.5,\\nsegment00002.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:04.500Z\\n#EXTINF:1.5,\\nsegment00003.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:06.000Z\\n#EXTINF:1.5,\\nsegment00004.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:07.500Z\\n#EXTINF:1.5,\\nsegment00005.ts\\n'); for (const index of [0,1,2,3,4,5]) writeFileSync(join(dirname(output), `segment0000${index}.ts`), 'segment'); }, 900); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(probeStarted)}, 'started'); process.stdout.write(JSON.stringify({format:{duration:'120',format_name:'matroska'},streams:[]}));\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const playlist = fetch(
      `${endpoint}/hls/42/0/ios-priority/master.m3u8?quality=480`,
    );
    await wait(120);
    const metadata = fetch(`${endpoint}/probe/42/0`);
    await wait(450);
    await expect(stat(probeStarted)).rejects.toThrow();

    const playlistResponse = await playlist;
    expect(playlistResponse.status).toBe(200);
    await expect(playlistResponse.text()).resolves.toContain("#EXTM3U");
    const metadataResponse = await metadata;
    expect(metadataResponse.status).toBe(200);
    await expect(stat(probeStarted)).resolves.toBeDefined();
  }, 15_000);

  test("explicitly releases a cacheable HLS bootstrap session before admitting a replacement", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nconst { dirname, join } = require('node:path'); const { mkdirSync, writeFileSync } = require('node:fs'); const output = process.argv.at(-1); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:1\\n#EXTINF:0.75,\\nsegment00000.ts\\n'); writeFileSync(join(dirname(output), 'segment00000.ts'), 'segment'); setInterval(() => {}, 1000);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const first = await fetch(
      `${endpoint}/hls/42/0/bootstrap-hls/master.m3u8?quality=bootstrap`,
    );
    expect(first.status).toBe(200);
    const beforeStop = await (await fetch(`${endpoint}/health`)).json();
    expect(beforeStop.capacity).toMatchObject({ activeHls: 1, inUse: 1 });
    expect(beforeStop.cachedBootstraps).toBe(1);

    const stopped = await fetch(`${endpoint}/stop/bootstrap-hls`, {
      method: "POST",
    });
    expect(stopped.status).toBe(204);
    const afterStop = await (await fetch(`${endpoint}/health`)).json();
    expect(afterStop.capacity).toMatchObject({ activeHls: 0, stopping: 0 });
    expect(afterStop.jobs).toBe(0);

    const replacement = await fetch(
      `${endpoint}/hls/42/0/replacement-hls/master.m3u8?quality=bootstrap`,
    );
    expect(replacement.status).toBe(200);
  }, 15_000);

  test("cleans up a stalled HLS startup before retrying the same session", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const launches = join(directory, "hls-launches"),
      session = `retry-hls-${crypto.randomUUID()}`,
      staleDirectory = join(tmpdir(), `kheyflix-hls-${session}`);
    directories.push(staleDirectory);
    await mkdir(staleDirectory, { recursive: true });
    await writeFile(
      join(staleDirectory, "master.m3u8"),
      "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.75,\nstale.ts\n",
    );
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\nconst { existsSync, mkdirSync, writeFileSync } = require('node:fs'); const { dirname, join } = require('node:path'); const launches = ${JSON.stringify(launches)}; if (!existsSync(launches)) { writeFileSync(launches, 'first'); setInterval(() => {}, 1000); } else { const output = process.argv.at(-1); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\\n#EXTINF:1.5,\\nsegment00000.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:01.500Z\\n#EXTINF:1.5,\\nsegment00001.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:03.000Z\\n#EXTINF:1.5,\\nsegment00002.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:04.500Z\\n#EXTINF:1.5,\\nsegment00003.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:06.000Z\\n#EXTINF:1.5,\\nsegment00004.ts\\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:07.500Z\\n#EXTINF:1.5,\\nsegment00005.ts\\n'); for (const index of [0,1,2,3,4,5]) writeFileSync(join(dirname(output), 'segment0000' + index + '.ts'), 'segment'); setInterval(() => {}, 1000); }\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
      { KHEYFLIX_HLS_STARTUP_TIMEOUT_MS: "1000" },
    );

    const stalled = await fetch(
      `${endpoint}/hls/42/0/${session}/master.m3u8?quality=480`,
    );
    expect(stalled.status).toBe(502);
    const afterFailure = await (await fetch(`${endpoint}/health`)).json();
    expect(afterFailure.capacity).toMatchObject({ activeHls: 0, pending: 0 });

    const retry = await fetch(
      `${endpoint}/hls/42/0/${session}/master.m3u8?quality=480`,
    );
    expect(retry.status).toBe(200);
    await expect(retry.text()).resolves.toContain("#EXTM3U");
  }, 15_000);

  test("does not spawn after a session is stopped while its probe is pending", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const launches = join(directory, "ffmpeg-launches"),
      probePayload = JSON.stringify({
        format: { duration: "120", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "h264",
            width: 1280,
            height: 720,
          },
          {
            index: 1,
            codec_type: "audio",
            codec_name: "aac",
            channels: 2,
          },
        ],
      });
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\nconst { appendFileSync } = require('node:fs'); appendFileSync(${JSON.stringify(launches)}, '1'); process.stdout.write('stream-bytes'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nsetTimeout(() => { process.stdout.write(${JSON.stringify(probePayload)}); process.exit(0); }, 800);\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );
    const controller = new AbortController();
    const startup = fetch(
      `${endpoint}/transcode/42/0?token=pending-probe&quality=original`,
      { signal: controller.signal },
    ).catch(() => undefined);
    await wait(150);
    const pending = await (await fetch(`${endpoint}/health`)).json();
    expect(pending.capacity).toMatchObject({ pending: 1, activeTranscodes: 0 });
    expect(pending.probes).toBe(1);

    const stopping = fetch(`${endpoint}/stop/pending-probe`, { method: "POST" });
    await wait(50);
    controller.abort();
    expect((await stopping).status).toBe(204);
    await startup;
    await wait(100);
    await expect(stat(launches)).rejects.toThrow();
    const cleared = await (await fetch(`${endpoint}/health`)).json();
    expect(cleared.capacity).toMatchObject({ pending: 0, activeTranscodes: 0 });

    const retry = await fetch(
      `${endpoint}/transcode/42/0?token=pending-probe&quality=original`,
    );
    expect(retry.status).toBe(200);
    await retry.body?.getReader().read();
    expect(await readFile(launches, "utf8")).toBe("1");
  }, 15_000);

  test("releases subtitle capacity when its metadata-probe client disconnects", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const launches = join(directory, "subtitle-launches"),
      probeStarted = join(directory, "subtitle-probe-started"),
      probePayload = JSON.stringify({
        format: { duration: "120", format_name: "matroska" },
        streams: [{ index: 2, codec_type: "subtitle", codec_name: "subrip" }],
      });
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(launches)}, 'started'); process.stdout.write('WEBVTT\\n'); setInterval(() => {}, 1000);\n`,
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(probeStarted)}, 'started'); setTimeout(() => { process.stdout.write(${JSON.stringify(probePayload)}); process.exit(0); }, 800);\n`,
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );

    const controller = new AbortController();
    const subtitle = fetch(`${endpoint}/subtitle/42/0/2.vtt`, {
      signal: controller.signal,
    }).catch(() => undefined);
    const probeDeadline = Date.now() + 1_000;
    let probing = false;
    while (Date.now() < probeDeadline) {
      try {
        await stat(probeStarted);
        probing = true;
        break;
      } catch {
        await wait(25);
      }
    }
    expect(probing).toBe(true);
    const duringProbe = await (await fetch(`${endpoint}/health`)).json();
    expect(duringProbe.capacity).toMatchObject({ pending: 1, activeSubtitles: 0 });

    controller.abort();
    await wait(100);
    const released = await (await fetch(`${endpoint}/health`)).json();
    expect(released.capacity).toMatchObject({ pending: 0, activeSubtitles: 0 });

    await subtitle;
    await wait(800);
    await expect(stat(launches)).rejects.toThrow();
  }, 15_000);

  test("returns an HLS startup failure as soon as the encoder exits", async () => {
    const app = createServer((_request, response) => response.writeHead(200).end());
    servers.push(app);
    const appPort = await listen(app);
    const directory = await mkdtemp(join(tmpdir(), "kheyflix-transcoder-test-"));
    directories.push(directory);
    const ffmpeg = await executable(
      directory,
      "ffmpeg",
      "#!/usr/bin/env node\nprocess.stderr.write('KHEYFLIX_TEST_PROCESS_SENTINEL'); process.exit(7);\n",
    );
    const ffprobe = await executable(
      directory,
      "ffprobe",
      "#!/usr/bin/env node\nprocess.stderr.write('unexpected media probe'); process.exit(91);\n",
    );
    const endpoint = await startTranscoder(
      `http://127.0.0.1:${appPort}`,
      ffmpeg,
      ffprobe,
    );
    const startedAt = Date.now();

    const playlist = await fetch(`${endpoint}/hls/42/0/ios-fail/master.m3u8?quality=480`);

    expect(playlist.status).toBe(502);
    await expect(playlist.text()).resolves.not.toContain(
      "KHEYFLIX_TEST_PROCESS_SENTINEL",
    );
    await wait(50);
    expect(diagnostics.get(endpoint)?.stderr).not.toContain(
      "KHEYFLIX_TEST_PROCESS_SENTINEL",
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  }, 15_000);
});
