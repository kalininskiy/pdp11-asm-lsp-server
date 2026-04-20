import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { DIRECTIVES, REGISTERS } from "./instructions";
import { OperandKind, OperandNode, ProgramNode, StatementNode } from "./types";

function range(line: number, start: number, end: number) {
  return { start: { line, character: start }, end: { line, character: end } };
}

const IDENTIFIER_RE = /^[A-Za-z_.$@?][A-Za-z0-9_.$@?]*$/;
const LOCAL_NUMERIC_RE = /^[0-9]+\$$/;
const NUMBER_RE = /^(?:[0-7]+|[0-9]+\.|0x[0-9a-fA-F]+)$/;

// Поддержка всех распространённых локальных меток (1:   1$:   10$:   .1:   @@1:  и т.д.)
const LABEL_RE = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+[$]?):/;

const EQU_RE = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$)\s+EQU\b(.*)$/i;
const DIRECT_ASSIGN_RE = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*)\s*=\s*(.+)$/i;

function normalizeRegister(reg: string): string {
  const upper = reg.toUpperCase();
  if (upper.startsWith("%")) {
    const num = parseInt(upper.slice(1), 10);
    if (num >= 0 && num <= 7) {
      if (num === 6) return "SP";
      if (num === 7) return "PC";
      return `R${num}`;
    }
  }
  return upper;
}

function isSymbolToken(text: string): boolean {
  return IDENTIFIER_RE.test(text) || LOCAL_NUMERIC_RE.test(text);
}

function replaceAliases(
  text: string,
  registerAliases: Map<string, string>,
): string {
  let result = text;
  for (const [alias, reg] of registerAliases) {
    // Replace whole words, case insensitive
    const regex = new RegExp(`\\b${alias}\\b`, "gi");
    result = result.replace(regex, reg);
  }
  return result;
}

function parseOperand(
  text: string,
  line: number,
  start: number,
  registerAliases: Map<string, string>,
): OperandNode {
  const trimmed = text.trim();
  const normalized = replaceAliases(trimmed, registerAliases);
  const upper = normalized.toUpperCase();
  const end = start + text.length;
  let kind: OperandKind = "unknown";
  let symbolName: string | undefined;
  let valueText: string | undefined;
  let register: OperandNode["register"];
  const regPattern = "(R[0-7]|SP|PC|%[0-7])";

  // Поддержка выражений вида: symbol+offset, symbol-offset, @#symbol+offset
  const offsetMatch = trimmed.match(
    /^(@?#?)([A-Za-z_.$@?][A-Za-z0-9_.$@?]*)([-+])(\d+)$/i,
  );
  if (offsetMatch) {
    const prefix = offsetMatch[1];
    const symbol = offsetMatch[2];
    const sign = offsetMatch[3];
    const offset = offsetMatch[4];

    symbolName = symbol;
    valueText = sign + offset;

    if (prefix === "@#") {
      kind = "absolute";
    } else if (prefix === "#") {
      kind = "immediate";
    } else {
      kind = "index";
    }

    return {
      text: trimmed,
      kind,
      symbolName,
      valueText,
      range: { line, start, end },
    };
  }

  const extractValueReference = (value: string): void => {
    const valueTrimmed = value.trim();
    valueText = valueTrimmed;
    if (isSymbolToken(valueTrimmed)) {
      symbolName = valueTrimmed;
    }
  };

  const absoluteMatch = trimmed.match(/^@#(.+)$/);
  if (absoluteMatch) {
    kind = "absolute";
    extractValueReference(absoluteMatch[1]);
  } else if (trimmed.startsWith("#")) {
    kind = "immediate";
    extractValueReference(trimmed.slice(1));
  } else if (new RegExp(`^@-\\(${regPattern}\\)$`, "i").test(upper)) {
    kind = "autodecrementDeferred";
    register = normalizeRegister(upper.slice(3, -1)) as OperandNode["register"];
  } else if (new RegExp(`^-\\(${regPattern}\\)$`, "i").test(upper)) {
    kind = "autodecrement";
    register = normalizeRegister(upper.slice(2, -1)) as OperandNode["register"];
  } else if (new RegExp(`^@\\(${regPattern}\\)\\+$`, "i").test(upper)) {
    kind = "autoincrementDeferred";
    register = normalizeRegister(upper.slice(2, -2)) as OperandNode["register"];
  } else if (new RegExp(`^\\(${regPattern}\\)\\+$`, "i").test(upper)) {
    kind = "autoincrement";
    register = normalizeRegister(upper.slice(1, -2)) as OperandNode["register"];
  } else if (new RegExp(`^@\\(${regPattern}\\)$`, "i").test(upper)) {
    kind = "registerDeferred";
    register = normalizeRegister(upper.slice(2, -1)) as OperandNode["register"];
  } else if (new RegExp(`^\\(${regPattern}\\)$`, "i").test(upper)) {
    kind = "registerDeferred";
    register = normalizeRegister(upper.slice(1, -1)) as OperandNode["register"];
  } else {
    const indexDeferred = upper.match(
      new RegExp(`^@(.+)\\(${regPattern}\\)$`, "i"),
    );
    if (indexDeferred) {
      kind = "indexDeferred";
      register = normalizeRegister(indexDeferred[2]) as OperandNode["register"];
      extractValueReference(indexDeferred[1]);
    } else {
      const index = upper.match(new RegExp(`^(.+)\\(${regPattern}\\)$`, "i"));
      if (index) {
        kind = "index";
        register = normalizeRegister(index[2]) as OperandNode["register"];
        extractValueReference(index[1]);
      } else if (REGISTERS.has(upper)) {
        kind = "register";
        register = normalizeRegister(upper) as OperandNode["register"];
      } else if (isSymbolToken(normalized)) {
        kind = "symbol";
        symbolName = normalized;
      } else if (NUMBER_RE.test(normalized)) {
        kind = "number";
        valueText = normalized;
      }
    }
  }

  return {
    text: trimmed,
    kind,
    register,
    symbolName,
    valueText,
    range: { line, start, end },
  };
}

function splitOperands(raw: string): Array<{ text: string; start: number }> {
  const result: Array<{ text: string; start: number }> = [];
  let current = "";
  let depth = 0;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      result.push({ text: current, start });
      current = "";
      start = i + 1;
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    result.push({ text: current, start });
  }
  return result;
}

export function parseProgram(text: string): ProgramNode {
  const statements: StatementNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = text.split(/\r?\n/);
  const knownMacros = new Set<string>();
  const registerAliases = new Map<string, string>();
  let inBlockComment = false; // Состояние для отслеживания многострочных комментариев /* ... */
  let openMacro:
    | {
        name: string;
        startLine: number;
      }
    | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    let codePart = raw;
    let comment: string | undefined = undefined;

    // Обработка строки с учётом состояния inBlockComment
    if (inBlockComment) {
      const blockEnd = raw.indexOf('*/');
      if (blockEnd !== -1) {
        // Комментарий заканчивается на этой строке
        comment = raw.slice(0, blockEnd + 2);
        codePart = raw.slice(blockEnd + 2);
        inBlockComment = false;
      } else {
        // Вся строка — часть многострочного комментария
        comment = raw;
        codePart = "";
      }
    } else {
      // Обычная строка (не внутри блочного комментария)

      // 1. Однострочный // 
      let pos = raw.indexOf('//');
      if (pos !== -1) {
        codePart = raw.slice(0, pos);
        comment = raw.slice(pos);
      } else {
        codePart = raw;
      }

      // 2. Начало блочного комментария /*
      pos = codePart.indexOf('/*');
      if (pos !== -1) {
        const blockEnd = codePart.indexOf('*/', pos + 2);

        if (blockEnd !== -1) {
          // /* ... */ целиком на одной строке (inline)
          if (comment) comment += " " + codePart.slice(pos);
          else comment = codePart.slice(pos);
          codePart = codePart.slice(0, pos);
        } else {
          // Начало многострочного комментария
          if (comment) comment += " " + codePart.slice(pos);
          else comment = codePart.slice(pos);
          codePart = codePart.slice(0, pos);
          inBlockComment = true;
        }
      }

      // 3. Классический PDP-11 комментарий ;
      pos = codePart.indexOf(';');
      if (pos !== -1) {
        if (comment) comment = codePart.slice(pos) + " " + (comment || "");
        else comment = codePart.slice(pos);
        codePart = codePart.slice(0, pos);
      }
    }

    const code = codePart.trimEnd();
    const stmt: StatementNode = {
      line: lineIndex,
      operands: [],
      comment,
      raw,
      range: { line: lineIndex, start: 0, end: raw.length }
    };

    let rest = code.trim();
    if (rest.length === 0) {
      statements.push(stmt);
      continue;
    }

    // 1. Прямая метка (включая числовые 1: 2: 3:)
    const labelMatch = rest.match(LABEL_RE);
    if (labelMatch) {
      stmt.label = labelMatch[1];
      rest = rest.slice(labelMatch[0].length).trim();
      if (rest.length === 0) {
        statements.push(stmt);
        continue;
      }
    }

    // 2. Присваивание через = (например, symbol = 1234 или symbol = otherSymbol)
    const assignMatch = rest.match(DIRECT_ASSIGN_RE);
    if (assignMatch) {
      stmt.label = assignMatch[1];
      stmt.directive = "="; // специальный directive
      const valueTail = assignMatch[2].trim();
      if (valueTail.length > 0) {
        stmt.operands.push(
          parseOperand(
            valueTail,
            lineIndex,
            code.indexOf(valueTail),
            registerAliases,
          ),
        );
      }
      statements.push(stmt);
      continue;
    }

    // 3. EQU
    const equMatch = rest.match(EQU_RE);
    if (equMatch) {
      stmt.label = equMatch[1];
      stmt.directive = "EQU";
      const valueTail = equMatch[2].trim();
      if (valueTail.length > 0) {
        stmt.operands.push(
          parseOperand(
            valueTail,
            lineIndex,
            code.indexOf(valueTail),
            registerAliases,
          ),
        );
      } else {
        diagnostics.push({
          message: "EQU requires value",
          severity: DiagnosticSeverity.Error,
          range: range(lineIndex, 0, rest.length),
        });
      }
      statements.push(stmt);
      continue;
    }

    // 4. Check for register alias assignment: %0 = AX
    const aliasMatch = rest.match(/^(%[0-7])\s*=\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (aliasMatch) {
      const reg = aliasMatch[1];
      const alias = aliasMatch[2].toUpperCase();
      registerAliases.set(alias, reg);
      statements.push(stmt); // Empty statement for alias
      continue;
    }

    const parts = rest.split(/\s+/, 2);
    const head = parts[0];
    const headUpper = head.toUpperCase();
    const tail = rest.slice(head.length).trim();
    const tailStart = code.indexOf(tail);

    if (headUpper === "EQU" && !stmt.label) {
      diagnostics.push({
        message: "EQU requires label before it",
        severity: DiagnosticSeverity.Error,
        range: range(lineIndex, 0, head.length),
      });
    }

    if (headUpper.startsWith(".") || headUpper === "EQU") {
      stmt.directive = headUpper;
      if (!DIRECTIVES.has(headUpper)) {
        diagnostics.push({
          message: `Unknown directive '${head}'`,
          severity: DiagnosticSeverity.Warning,
          range: range(lineIndex, 0, head.length),
        });
      }

      if (headUpper === ".MACRO") {
        const macroParts = tail.split(/\s+/).filter((p) => p.length > 0);
        if (macroParts.length === 0) {
          diagnostics.push({
            message: ".MACRO requires a macro name",
            severity: DiagnosticSeverity.Error,
            range: range(lineIndex, 0, raw.length),
          });
        } else {
          const macroName = macroParts[0];
          knownMacros.add(macroName.toUpperCase());
          openMacro = { name: macroName, startLine: lineIndex };
          stmt.macroDefinition = {
            name: macroName,
            parameters: macroParts.slice(1).map((p) => p.replace(/,$/, "")),
            startLine: lineIndex,
            endLine: lineIndex,
          };
        }
      } else if (headUpper === ".ENDM") {
        if (!openMacro) {
          diagnostics.push({
            message: ".ENDM without matching .MACRO",
            severity: DiagnosticSeverity.Error,
            range: range(lineIndex, 0, head.length),
          });
        } else {
          stmt.macroDefinition = {
            name: openMacro.name,
            parameters: [],
            startLine: openMacro.startLine,
            endLine: lineIndex,
          };
          openMacro = undefined;
        }
      }
    } else if (knownMacros.has(headUpper)) {
      stmt.macroInvocation = {
        name: head,
        arguments: [],
      };
    } else {
      stmt.opcode = headUpper;
    }

    if (tail.length > 0) {
      for (const item of splitOperands(tail)) {
        const operand = parseOperand(
          item.text,
          lineIndex,
          Math.max(0, tailStart) + item.start,
          registerAliases,
        );
        stmt.operands.push(operand);
        if (stmt.macroInvocation) {
          stmt.macroInvocation.arguments.push(operand);
        }
      }
    }

    statements.push(stmt);
  }

  if (openMacro) {
    diagnostics.push({
      message: `.MACRO '${openMacro.name}' is not terminated by .ENDM`,
      severity: DiagnosticSeverity.Error,
      range: range(
        openMacro.startLine,
        0,
        lines[openMacro.startLine]?.length ?? 0,
      ),
    });
  }

  return { statements, diagnostics };
}
