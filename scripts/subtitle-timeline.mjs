import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";

const TIMING = /(?<start>(?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> (?<end>(?:\d{2}:)?\d{2}:\d{2}\.\d{3})(?<settings>[^\n]*)/;

const secondsForTimestamp = (value) => {
  const parts = value.split(":").map(Number);
  const seconds = parts.pop() || 0,
    minutes = parts.pop() || 0,
    hours = parts.pop() || 0;
  return hours * 3600 + minutes * 60 + seconds;
};

const timestampForSeconds = (value) => {
  const milliseconds = Math.max(0, Math.round(value * 1000)),
    hours = Math.floor(milliseconds / 3_600_000),
    minutes = Math.floor((milliseconds % 3_600_000) / 60_000),
    seconds = Math.floor((milliseconds % 60_000) / 1000),
    remainder = milliseconds % 1000,
    clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${clock}` : clock;
};

const rebaseBlock = (block, offset) => {
  const match = block.match(TIMING);
  if (!match?.groups) return block;
  const start = secondsForTimestamp(match.groups.start),
    end = secondsForTimestamp(match.groups.end);
  if (end <= offset) return "";
  return block.replace(
    TIMING,
    `${timestampForSeconds(Math.max(start, offset) - offset)} --> ${timestampForSeconds(end - offset)}${match.groups.settings}`,
  );
};

export function rebaseWebVtt(value, offset = 0) {
  const normalized = value.replace(/\r\n/g, "\n"),
    trailingNewline = normalized.endsWith("\n"),
    blocks = normalized
      .split(/\n\n+/)
      .map((block) => rebaseBlock(block.replace(/\n+$/, ""), offset))
      .filter(Boolean);
  return `${blocks.join("\n\n")}${trailingNewline ? "\n" : ""}`;
}

export function createWebVttRebaseTransform(offset = 0) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk).replace(/\r\n/g, "\n");
      const blocks = pending.split(/\n\n+/);
      pending = blocks.pop() || "";
      for (const block of blocks) {
        const rebased = rebaseBlock(block, offset);
        if (rebased) this.push(`${rebased}\n\n`);
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      const rebased = rebaseBlock(pending.replace(/\n+$/, ""), offset);
      if (rebased) this.push(`${rebased}\n`);
      callback();
    },
  });
}
