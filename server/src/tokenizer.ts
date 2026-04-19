export type TokenType =
  | "identifier"
  | "number"
  | "directive"
  | "comment"
  | "comma"
  | "colon"
  | "operator"
  | "lparen"
  | "rparen"
  | "string"
  | "unknown";

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ type: "comment", value: line.slice(i), start: i, end: line.length });
      break;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (/[#@+\-]/.test(ch)) {
      tokens.push({ type: "operator", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "\"") {
      const start = i;
      i++;
      while (i < line.length && line[i] !== "\"") {
        i++;
      }
      i = Math.min(i + 1, line.length);
      tokens.push({ type: "string", value: line.slice(start, i), start, end: i });
      continue;
    }
    if (/[.A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < line.length && /[A-Za-z0-9_.$]/.test(line[i])) {
        i++;
      }
      const value = line.slice(start, i);
      tokens.push({
        type: value.startsWith(".") ? "directive" : "identifier",
        value,
        start,
        end: i
      });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < line.length && /[0-9]/.test(line[i])) {
        i++;
      }
      if (line[i] === ".") {
        i++;
      }
      tokens.push({ type: "number", value: line.slice(start, i), start, end: i });
      continue;
    }

    tokens.push({ type: "unknown", value: ch, start: i, end: i + 1 });
    i++;
  }
  return tokens;
}
