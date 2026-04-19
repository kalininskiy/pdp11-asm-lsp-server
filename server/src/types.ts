import { Diagnostic } from "vscode-languageserver";

export type RegisterName = "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "SP" | "PC";

export type OperandKind =
  | "register"
  | "registerDeferred"
  | "autoincrement"
  | "autoincrementDeferred"
  | "autodecrement"
  | "autodecrementDeferred"
  | "index"
  | "indexDeferred"
  | "immediate"
  | "absolute"
  | "symbol"
  | "number"
  | "unknown";

export interface SourceRange {
  line: number;
  start: number;
  end: number;
}

export interface OperandNode {
  text: string;
  kind: OperandKind;
  register?: RegisterName;
  symbolName?: string;
  valueText?: string;
  range: SourceRange;
}
export interface MacroDefinition {
  name: string;
  parameters: string[];
  startLine: number;
  endLine: number;
}

export interface MacroInvocation {
  name: string;
  arguments: OperandNode[];
}

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
}

export interface ProgramNode {
  statements: StatementNode[];
  diagnostics: Diagnostic[];
}

export interface SymbolEntry {
  name: string;
  displayName: string;
  kind: "label" | "equ" | "macro";
  line: number;
  scope?: string;
  valueText?: string;
  uri: string;
}

export interface TargetProfile {
  name: "BK-0010" | "BK-0011M" | "UKNC";
  memoryMap: Array<{ name: string; start: number; end: number; kind: "RAM" | "VideoRAM" | "IO" | "ROM" }>;
  ioMap: string[];
}

export interface AnalysisResult {
  symbols: Map<string, SymbolEntry>;
  diagnostics: Diagnostic[];
}
