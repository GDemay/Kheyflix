// Redacting logger: console + JSONL transcript file. Every line passes the
// redactor before it reaches either sink (docs/secrets.md).

import fs from 'node:fs';
import path from 'node:path';
import { redactString } from './redact.js';

export function createLogger({ dir, extraSecrets = [], stream = process.stderr } = {}) {
  let fd = null;
  const ensureFile = () => {
    if (!dir || fd !== null) return;
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(path.join(dir, 'controller.log'), 'a');
  };
  const write = (level, msg, fields) => {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      msg: redactString(msg, extraSecrets),
      ...(fields ? { fields: JSON.parse(redactString(JSON.stringify(fields), extraSecrets)) } : {}),
    });
    ensureFile();
    if (fd !== null) fs.writeSync(fd, line + '\n');
    stream.write(line + '\n');
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child(sub) {
      return createLogger({ dir, extraSecrets, stream });
    },
    close() {
      if (fd !== null) {
        fs.closeSync(fd);
        fd = null;
      }
    },
  };
}

export function tail(text, maxBytes) {
  if (text == null) return '';
  const s = String(text);
  return s.length <= maxBytes ? s : `…${s.slice(s.length - maxBytes)}`;
}
