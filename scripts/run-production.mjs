import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const transcoderPort = process.env.KHEYFLIX_TRANSCODER_PORT || "3101";
const env = {
  ...process.env,
  PORT: port,
  KHEYFLIX_APP_ORIGIN:
    process.env.KHEYFLIX_APP_ORIGIN || `http://127.0.0.1:${port}`,
  KHEYFLIX_TRANSCODER_URL:
    process.env.KHEYFLIX_TRANSCODER_URL ||
    `http://127.0.0.1:${transcoderPort}`,
  KHEYFLIX_TRANSCODER_PORT: transcoderPort,
};

const children = [
  spawn(process.execPath, ["scripts/transcoder.mjs"], {
    env,
    stdio: "inherit",
  }),
  spawn("node_modules/.bin/vinext", ["start"], {
    env,
    stdio: "inherit",
  }),
];

let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

for (const child of children) {
  child.on("error", (error) => {
    console.error(`Production process failed to start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `Production process exited unexpectedly (${signal || code || 0}).`,
      );
      stop();
      process.exitCode = code || 1;
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}
