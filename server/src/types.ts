import { Diagnostic } from "vscode-languageserver";

/**
 * Названия регистров, поддерживаемые в операндах
 */
export type RegisterName = "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "SP" | "PC";

/**
 * Типы операндов, которые могут быть распознаны в программе
 */
export type OperandKind =
  | "register"              // Rn      Register direct
  | "registerDeferred"      // (Rn)    Register deferred
  | "autoincrement"         // (Rn)+   Autoincrement
  | "autoincrementDeferred" // @(Rn)+  Autoincrement deferred
  | "autodecrement"         // -(Rn)   Autodecrement
  | "autodecrementDeferred" // @-(Rn)  Autodecrement deferred
  | "index"                 // X(Rn)   Index
  | "indexDeferred"         // @X(Rn)  Index deferred
  | "immediate"             // #N      Immediate
  | "absolute"              // Absolute
  | "symbol"                // Symbolic
  | "number"                // Absolute number
  | "unknown";              // Unknown

/**
 * Интерфейс для представления диапазона в исходном коде
 */
export interface SourceRange {
  line: number;
  start: number;
  end: number;
}

/**
 * Интерфейс для представления операнда в программе
 */
export interface OperandNode {
  text: string;
  kind: OperandKind;
  register?: RegisterName;
  symbolName?: string;
  valueText?: string;
  range: SourceRange;
}

/**
 * Интерфейс для представления определения макроса
 */
export interface MacroDefinition {
  name: string;
  parameters: string[];
  startLine: number;
  endLine: number;
}

/**
 * Интерфейс для представления вызова макроса
 */
export interface MacroInvocation {
  name: string;
  arguments: OperandNode[];
}

/**
 * Интерфейс для представления инструкции или директивы в программе
 */
export interface StatementNode {
  line: number;
  label?: string;
  opcode?: string;
  directive?: string;
  operands: OperandNode[];
  macroDefinition?: MacroDefinition;
  macroInvocation?: MacroInvocation;
  comment?: string;
  raw: string;
  range: SourceRange;
  context?: "normal" | "script";
}

/**
 * Интерфейс для представления всей программы, включая список инструкций и диагностику
 */
export interface ProgramNode {
  statements: StatementNode[];
  diagnostics: Diagnostic[];
}

/**
 * Интерфейс для представления записи в таблице символов, которая будет использоваться для автодополнения, переходов и других функций
 */
export interface SymbolEntry {
  name: string;
  displayName: string;
  kind: "label" | "equ" | "macro";
  line: number;
  scope?: string;
  valueText?: string;
  uri: string;
}

/**
 * Интерфейс для представления профиля целевой платформы, который будет использоваться для валидации инструкций и предоставления контекстной информации
 */
export interface TargetProfile {
  name: "BK-0010" | "BK-0011M" | "UKNC";
  memoryMap: Array<{ name: string; start: number; end: number; kind: "RAM" | "VideoRAM" | "IO" | "ROM" }>;
  ioMap: string[];
}

/**
 * Интерфейс для представления результата анализа программы, который включает в себя таблицу символов и массив диагностических сообщений
 */
export interface AnalysisResult {
  symbols: Map<string, SymbolEntry>;
  diagnostics: Diagnostic[];
  macros: Map<string, number>;
}
