import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";

function tokenize(raw) {
  const tokens = [];
  let cur = "";
  let quote = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && i + 1 < raw.length) {
        i += 1;
        cur += raw[i];
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }

    cur += ch;
  }

  if (quote) {
    throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "Unclosed quote in command");
  }

  if (cur) {
    tokens.push(cur);
  }

  return tokens;
}

export function parseRpCommand(content) {
  if (!content || !content.startsWith("/rp")) {
    return null;
  }

  const tokens = tokenize(content.trim());
  if (tokens.length === 1) {
    return { command: "help", args: [], options: {} };
  }

  const command = tokens[1];
  const args = [];
  const options = {};

  for (let i = 2; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!key) {
        throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "Invalid option name");
      }
      const next = tokens[i + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(options, key)) {
        if (!Array.isArray(options[key])) {
          options[key] = [options[key]];
        }
        options[key].push(next);
      } else {
        options[key] = next;
      }
      i += 1;
      continue;
    }
    args.push(token);
  }

  return { command, args, options };
}
