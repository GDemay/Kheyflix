import { spawn } from "node:child_process";

import { loadLocalEnvironment, resolveDevEnvironment } from "./run-dev-support.mjs";

const { env, startApp, startTranscoder } = await resolveDevEnvironment(
  await loadLocalEnvironment(),
);
const children = [];

if (!startApp) {
  console.log(
    `Kheyflix is already running at http://localhost:${env.PORT}. Nothing else to start.`,
  );
  process.exit(0);
}

if (startTranscoder) {
  children.push(
    spawn(process.execPath, ["scripts/transcoder.mjs"], {
      stdio: "inherit",
      env,
    }),
  );
} else {
  console.log(
    `Reusing Kheyflix media compatibility service on ${env.KHEYFLIX_TRANSCODER_URL}.`,
  );
}

children.push(
  spawn("node_modules/.bin/vinext", ["dev", "--port", env.PORT], {
    stdio: "inherit",
    env,
  }),
);

let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
};

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => stop(signal));

for (const child of children) {
  child.on("error", (error) => {
    console.error(`Development process failed to start: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `Development process exited unexpectedly (${signal || code || 0}).`,
    );
    process.exitCode = code || 1;
    stop();
  });
}
