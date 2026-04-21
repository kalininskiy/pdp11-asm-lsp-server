import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { DIRECTIVES, InstructionMeta, PDP11_INSTRUCTIONS } from "./instructions";
import { AnalysisResult, OperandNode, ProgramNode, SymbolEntry, TargetProfile } from "./types";

const TARGET_PROFILES: Record<string, TargetProfile> = {
  "BK-0010": {
    name: "BK-0010",
    memoryMap: [
      { name: "RAM", start: 0o000000, end: 0o137777, kind: "RAM" },
      { name: "IO", start: 0o177400, end: 0o177777, kind: "IO" }
    ],
    ioMap: ["177560", "177564"]
  },
  "BK-0011M": {
    name: "BK-0011M",
    memoryMap: [
      { name: "RAM", start: 0o000000, end: 0o157777, kind: "RAM" },
      { name: "VideoRAM", start: 0o160000, end: 0o167777, kind: "VideoRAM" },
      { name: "IO", start: 0o177400, end: 0o177777, kind: "IO" }
    ],
    ioMap: ["177560", "177662"]
  },
  UKNC: {
    name: "UKNC",
    memoryMap: [
      { name: "RAM", start: 0o000000, end: 0o157777, kind: "RAM" },
      { name: "IO", start: 0o176000, end: 0o177777, kind: "IO" }
    ],
    ioMap: ["176640", "176646"]
  }
};

function range(line: number, start: number, end: number) {
  return { start: { line, character: start }, end: { line, character: end } };
}

function parsePdp11Number(text: string): number | undefined {
  const clean = text.trim();
  if (/^[0-7]+$/.test(clean)) {
    return Number.parseInt(clean, 8);
  }
  if (/^[0-9]+\.$/.test(clean)) {
    return Number.parseInt(clean.slice(0, -1), 10);
  }
  if (/^0x[0-9a-f]+$/i.test(clean)) {
    return Number.parseInt(clean, 16);
  }
  return undefined;
}

function normalizeSymbolKey(name: string): string {
  return name.toUpperCase();
}

function isLocalSymbol(name: string): boolean {
  return (
    name.startsWith(".") ||
    /^[0-9]+\$?$/.test(name) ||
    name.endsWith("$") ||
    name.startsWith("@@")
  );
}

function makeScopedName(name: string, scope: string): string {
  if (isLocalSymbol(name)) {
    return `${scope}::${normalizeSymbolKey(name)}`;
  }
  return normalizeSymbolKey(name);
}

function extractAddressCandidate(op: OperandNode): string | undefined {
  if (op.kind === "immediate" || op.kind === "absolute" || op.kind === "number") {
    return op.valueText ?? op.text.replace(/^@?#/, "");
  }
  return undefined;
}

function validateInstruction(meta: InstructionMeta, line: number, operandKinds: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Специальные исключения для некоторых инструкций, которые могут принимать нестандартные операнды
  const opcode = meta.mnemonic;

  if (opcode === "DEC" || opcode === "INC" || opcode === "CLR" || opcode === "COM" || opcode === "NEG") {
    // Разрешаем immediate как destination для этих инструкций
    if (operandKinds.length === 1 && operandKinds[0] === "immediate") {
      return []; // считаем валидным
    }
  }

  if (operandKinds.length !== meta.operands) {
    diagnostics.push({
      message: `${meta.mnemonic} expects ${meta.operands} operand(s), got ${operandKinds.length}`,
      severity: DiagnosticSeverity.Error,
      range: range(line, 0, meta.mnemonic.length)
    });
    return diagnostics;
  }

  if (meta.operands === 1 && meta.allowedDst && !meta.allowedDst.includes(operandKinds[0] as never)) {
    diagnostics.push({
      message: `Invalid operand mode '${operandKinds[0]}' for ${meta.mnemonic}`,
      severity: DiagnosticSeverity.Error,
      range: range(line, 0, meta.mnemonic.length)
    });
  }
  if (meta.operands === 2) {
    if (meta.allowedSrc && !meta.allowedSrc.includes(operandKinds[0] as never)) {
      diagnostics.push({
        message: `Invalid source operand mode '${operandKinds[0]}' for ${meta.mnemonic}`,
        severity: DiagnosticSeverity.Error,
        range: range(line, 0, meta.mnemonic.length)
      });
    }
    if (meta.allowedDst && !meta.allowedDst.includes(operandKinds[1] as never)) {
      diagnostics.push({
        message: `Invalid destination operand mode '${operandKinds[1]}' for ${meta.mnemonic}`,
        severity: DiagnosticSeverity.Error,
        range: range(line, 0, meta.mnemonic.length)
      });
    }
  }
  return diagnostics;
}

export function analyzeProgram(program: ProgramNode, uri: string, targetProfileName: string): AnalysisResult {
  const symbols = new Map<string, SymbolEntry>();
  const diagnostics: Diagnostic[] = [...program.diagnostics];
  const target = TARGET_PROFILES[targetProfileName] ?? TARGET_PROFILES["BK-0010"];
  const macroSignatures = new Map<string, number>();

  // Проверяем наличие .INCLUDE директив
  const hasIncludeDirectives = program.statements.some(
    stmt => stmt.directive?.toUpperCase() === ".INCLUDE"
  );

  // Добавляем встроенные символы (текущий адрес)
  symbols.set(".", {
    name: ".",
    displayName: ".",
    kind: "label",
    line: 0,
    uri
  });

  let currentScope = "__FILE__";
  for (const stmt of program.statements) {
    if (stmt.label && !isLocalSymbol(stmt.label)) {
      currentScope = normalizeSymbolKey(stmt.label);
    }
    if (stmt.label) {
      const key = makeScopedName(stmt.label, currentScope);
      symbols.set(key, {
        name: key,
        displayName: stmt.label,
        kind: "label",
        line: stmt.line,
        scope: currentScope,
        uri
      });
    }
    if ((stmt.directive === "EQU" || stmt.directive === "=") && stmt.label) {
      const key = makeScopedName(stmt.label, currentScope);
      symbols.set(key, {
        name: key,
        displayName: stmt.label,
        kind: "equ",
        line: stmt.line,
        scope: currentScope,
        valueText: stmt.operands[0]?.text,
        uri
      });
    }
    if (stmt.directive === ".MACRO" && stmt.macroDefinition) {
      const macroName = normalizeSymbolKey(stmt.macroDefinition.name);
      symbols.set(macroName, {
        name: macroName,
        displayName: stmt.macroDefinition.name,
        kind: "macro",
        line: stmt.line,
        uri
      });
      macroSignatures.set(macroName, stmt.macroDefinition.parameters.length);
    }
  }

  let inMacroBody = false;
  currentScope = "__FILE__";
  for (const stmt of program.statements) {
    if (stmt.directive === ".MACRO") {
      inMacroBody = true;
    } else if (stmt.directive === ".ENDM") {
      inMacroBody = false;
      continue;
    }

    if (stmt.label && !isLocalSymbol(stmt.label)) {
      currentScope = normalizeSymbolKey(stmt.label);
    }

    if (stmt.opcode) {
      const maybeMacro = macroSignatures.get(normalizeSymbolKey(stmt.opcode));
      if (maybeMacro !== undefined) {
        if (stmt.operands.length !== maybeMacro) {
          diagnostics.push({
            message: `Macro '${stmt.opcode}' expects ${maybeMacro} argument(s), got ${stmt.operands.length}`,
            severity: DiagnosticSeverity.Error,
            range: range(stmt.line, 0, stmt.opcode.length)
          });
        }
      } else {
        const meta = PDP11_INSTRUCTIONS[stmt.opcode];
        if (!meta) {
          diagnostics.push({
            message: `Unknown instruction '${stmt.opcode}'`,
            severity: DiagnosticSeverity.Warning,
            range: range(stmt.line, 0, stmt.opcode.length)
          });
        } else {
          diagnostics.push(...validateInstruction(meta, stmt.line, stmt.operands.map((o) => o.kind)));
        }
      }
    }

    if (stmt.directive && !DIRECTIVES.has(stmt.directive)) {
      diagnostics.push({
        message: `Unsupported directive '${stmt.directive}'`,
        severity: DiagnosticSeverity.Warning,
        range: range(stmt.line, 0, stmt.directive.length)
      });
    }

    if (inMacroBody) {
      continue;
    }

    for (const op of stmt.operands) {
      if (op.symbolName) {
        // Пропускаем проверку для текущего адреса
        if (op.symbolName === ".") {
          continue;
        }
        
        // Не показываем ошибку для имён файлов в .include
        if (op.symbolName && stmt.directive?.toUpperCase() === ".INCLUDE") { continue; }

        const symbolKey = makeScopedName(op.symbolName, currentScope);
        const globalKey = normalizeSymbolKey(op.symbolName);
        if (!symbols.has(symbolKey) && !symbols.has(globalKey)) {
          const severity = hasIncludeDirectives ? DiagnosticSeverity.Information : DiagnosticSeverity.Error;
          diagnostics.push({
            message: hasIncludeDirectives
              ? `Symbol '${op.symbolName}' may be defined in included module`
              : `Unresolved symbol '${op.symbolName}'`,
            severity,
            range: range(op.range.line, op.range.start, op.range.end)
          });
        }
      }
      const candidate = extractAddressCandidate(op);
      if (candidate && stmt.directive === ".ORG") {
        const value = parsePdp11Number(candidate);
        if (value !== undefined) {
          const inMap = target.memoryMap.some((m) => value >= m.start && value <= m.end);
          if (!inMap) {
            diagnostics.push({
              message: `Address ${candidate} is outside memory map of ${target.name}`,
              severity: DiagnosticSeverity.Warning,
              range: range(op.range.line, op.range.start, op.range.end)
            });
          }
        }
      }
    }
  }

  return { symbols, diagnostics };
}
