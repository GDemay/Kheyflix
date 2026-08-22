import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const original = `\tconst nodeStream = Readable.fromWeb(webResponse.body);
\tif (shouldCompress) pipeline(nodeStream, createCompressor(encoding, "streaming"), res, () => {});
\telse pipeline(nodeStream, res, () => {});`;

const patched = `\tif (res.destroyed || res.writableEnded) {
\t\tcancelResponseBody(webResponse);
\t\treturn;
\t}
\tconst nodeStream = Readable.fromWeb(webResponse.body);
\ttry {
\t\tif (shouldCompress) pipeline(nodeStream, createCompressor(encoding, "streaming"), res, () => {});
\t\telse pipeline(nodeStream, res, () => {});
\t} catch (error) {
\t\tif (error?.code !== "ERR_STREAM_UNABLE_TO_PIPE") throw error;
\t\tcancelResponseBody(webResponse);
\t}`;

export function patchVinextSource(source) {
  if (source.includes(patched)) return source;
  if (!source.includes(original))
    throw new Error(
      "The Vinext response-stream implementation changed; review the disconnect patch.",
    );
  return source.replace(original, patched);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const target = fileURLToPath(
    new URL("../node_modules/vinext/dist/server/prod-server.js", import.meta.url),
  );
  const source = readFileSync(target, "utf8");
  const next = patchVinextSource(source);
  if (next !== source) {
    writeFileSync(target, next);
    console.log("Patched Vinext response cleanup for disconnected streams.");
  }
}
