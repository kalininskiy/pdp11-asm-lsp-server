import { OperandKind } from "./types";

export interface InstructionMeta {
  mnemonic: string;
  description: string;
  operands: 0 | 1 | 2;
  allowedDst?: OperandKind[];
  allowedSrc?: OperandKind[];
  affects: string[];
  cycles: string;
}
const MEMORY_MODES: OperandKind[] = [
  "registerDeferred",
  "autoincrement",
  "autoincrementDeferred",
  "autodecrement",
  "autodecrementDeferred",
  "index",
  "indexDeferred",
  "absolute",
  "symbol",
  "number"
];
const ANY_DST: OperandKind[] = ["register", ...MEMORY_MODES];
const ANY_SRC: OperandKind[] = [...ANY_DST, "immediate"];
const BRANCH_DST: OperandKind[] = ["symbol", "number"];
const JMP_DST: OperandKind[] = ["register", ...MEMORY_MODES];

export const PDP11_INSTRUCTIONS: Record<string, InstructionMeta> = {
  MOV: { mnemonic: "MOV", description: "Move word source to destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  MOVB: { mnemonic: "MOVB", description: "Move byte source to destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  CMP: { mnemonic: "CMP", description: "Compare source and destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_SRC, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  CMPB: { mnemonic: "CMPB", description: "Compare byte source and destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_SRC, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  BIT: { mnemonic: "BIT", description: "Bit test", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_SRC, affects: ["N", "Z", "V"], cycles: "8+" },
  BITB: { mnemonic: "BITB", description: "Bit test byte", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_SRC, affects: ["N", "Z", "V"], cycles: "8+" },
  BIC: { mnemonic: "BIC", description: "Bit clear", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  BICB: { mnemonic: "BICB", description: "Bit clear byte", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  BIS: { mnemonic: "BIS", description: "Bit set", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  BISB: { mnemonic: "BISB", description: "Bit set byte", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  ADD: { mnemonic: "ADD", description: "Add source to destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  SUB: { mnemonic: "SUB", description: "Subtract source from destination", operands: 2, allowedSrc: ANY_SRC, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  MUL: { mnemonic: "MUL", description: "Multiply source by register pair", operands: 2, allowedSrc: ANY_SRC, allowedDst: ["register"], affects: ["N", "Z", "V", "C"], cycles: "20+" },
  DIV: { mnemonic: "DIV", description: "Divide register pair by source", operands: 2, allowedSrc: ANY_SRC, allowedDst: ["register"], affects: ["N", "Z", "V", "C"], cycles: "40+" },
  ASH: { mnemonic: "ASH", description: "Arithmetic shift register", operands: 2, allowedSrc: ANY_SRC, allowedDst: ["register"], affects: ["N", "Z", "V", "C"], cycles: "16+" },
  ASHC: { mnemonic: "ASHC", description: "Arithmetic shift register pair", operands: 2, allowedSrc: ANY_SRC, allowedDst: ["register"], affects: ["N", "Z", "V", "C"], cycles: "20+" },
  XOR: { mnemonic: "XOR", description: "Exclusive OR register with destination", operands: 2, allowedSrc: ["register"], allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "12+" },

  CLR: { mnemonic: "CLR", description: "Clear destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  CLRB: { mnemonic: "CLRB", description: "Clear destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  COM: { mnemonic: "COM", description: "Complement destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  COMB: { mnemonic: "COMB", description: "Complement destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  INC: { mnemonic: "INC", description: "Increment destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  INCB: { mnemonic: "INCB", description: "Increment destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  DEC: { mnemonic: "DEC", description: "Decrement destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  DECB: { mnemonic: "DECB", description: "Decrement destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  NEG: { mnemonic: "NEG", description: "Negate destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  NEGB: { mnemonic: "NEGB", description: "Negate destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ADC: { mnemonic: "ADC", description: "Add carry to destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ADCB: { mnemonic: "ADCB", description: "Add carry to destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  SBC: { mnemonic: "SBC", description: "Subtract carry from destination", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  SBCB: { mnemonic: "SBCB", description: "Subtract carry from destination byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  TST: { mnemonic: "TST", description: "Test destination", operands: 1, allowedDst: ANY_SRC, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  TSTB: { mnemonic: "TSTB", description: "Test destination byte", operands: 1, allowedDst: ANY_SRC, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ROR: { mnemonic: "ROR", description: "Rotate right through carry", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  RORB: { mnemonic: "RORB", description: "Rotate right byte through carry", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ROL: { mnemonic: "ROL", description: "Rotate left through carry", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ROLB: { mnemonic: "ROLB", description: "Rotate left byte through carry", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ASR: { mnemonic: "ASR", description: "Arithmetic shift right", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ASRB: { mnemonic: "ASRB", description: "Arithmetic shift right byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ASL: { mnemonic: "ASL", description: "Arithmetic shift left", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  ASLB: { mnemonic: "ASLB", description: "Arithmetic shift left byte", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V", "C"], cycles: "8+" },
  SWAB: { mnemonic: "SWAB", description: "Swap bytes in word", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  SXT: { mnemonic: "SXT", description: "Sign extend from N flag", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },
  JMP: { mnemonic: "JMP", description: "Jump to destination", operands: 1, allowedDst: JMP_DST, affects: [], cycles: "8+" },
  MARK: { mnemonic: "MARK", description: "Stack frame teardown", operands: 1, allowedDst: ["number", "symbol"], affects: [], cycles: "12" },
  MFPI: { mnemonic: "MFPI", description: "Move from previous instruction space", operands: 1, allowedDst: JMP_DST, affects: ["N", "Z", "V"], cycles: "16+" },
  MFPD: { mnemonic: "MFPD", description: "Move from previous data space", operands: 1, allowedDst: JMP_DST, affects: ["N", "Z", "V"], cycles: "16+" },
  MTPI: { mnemonic: "MTPI", description: "Move to previous instruction space", operands: 1, allowedDst: JMP_DST, affects: ["N", "Z", "V"], cycles: "16+" },
  MTPD: { mnemonic: "MTPD", description: "Move to previous data space", operands: 1, allowedDst: JMP_DST, affects: ["N", "Z", "V"], cycles: "16+" },
  MTPS: { mnemonic: "MTPS", description: "Move to processor status", operands: 1, allowedDst: ANY_SRC, affects: [], cycles: "8+" },
  MFPS: { mnemonic: "MFPS", description: "Move from processor status", operands: 1, allowedDst: ANY_DST, affects: ["N", "Z", "V"], cycles: "8+" },

  BR: { mnemonic: "BR", description: "Branch always", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BNE: { mnemonic: "BNE", description: "Branch if not equal", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BEQ: { mnemonic: "BEQ", description: "Branch if equal", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BGE: { mnemonic: "BGE", description: "Branch if greater or equal", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BLT: { mnemonic: "BLT", description: "Branch if less than", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BGT: { mnemonic: "BGT", description: "Branch if greater than", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BLE: { mnemonic: "BLE", description: "Branch if less or equal", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BPL: { mnemonic: "BPL", description: "Branch if plus", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BMI: { mnemonic: "BMI", description: "Branch if minus", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BHI: { mnemonic: "BHI", description: "Branch if higher", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BLOS: { mnemonic: "BLOS", description: "Branch if lower or same", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BVC: { mnemonic: "BVC", description: "Branch if overflow clear", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BVS: { mnemonic: "BVS", description: "Branch if overflow set", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BCC: { mnemonic: "BCC", description: "Branch if carry clear", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BCS: { mnemonic: "BCS", description: "Branch if carry set", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BHIS: { mnemonic: "BHIS", description: "Branch if higher or same", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },
  BLO: { mnemonic: "BLO", description: "Branch if lower", operands: 1, allowedDst: BRANCH_DST, affects: [], cycles: "8" },

  JSR: { mnemonic: "JSR", description: "Jump to subroutine", operands: 2, allowedSrc: ["register"], allowedDst: MEMORY_MODES, affects: [], cycles: "12+" },
  RTS: { mnemonic: "RTS", description: "Return from subroutine", operands: 1, allowedDst: ["register"], affects: [], cycles: "10" },
  SOB: { mnemonic: "SOB", description: "Subtract one and branch", operands: 2, allowedSrc: ["register"], allowedDst: BRANCH_DST, affects: [], cycles: "8+" },
  EMT: { mnemonic: "EMT", description: "Emulator trap", operands: 1, allowedDst: ["number", "symbol"], affects: [], cycles: "48" },
  TRAP: { mnemonic: "TRAP", description: "Trap instruction", operands: 1, allowedDst: ["number", "symbol"], affects: [], cycles: "48" },

  HALT: { mnemonic: "HALT", description: "Stop processor", operands: 0, affects: [], cycles: "7" },
  WAIT: { mnemonic: "WAIT", description: "Wait for interrupt", operands: 0, affects: [], cycles: "7" },
  RTI: { mnemonic: "RTI", description: "Return from interrupt", operands: 0, affects: [], cycles: "20" },
  RTT: { mnemonic: "RTT", description: "Return from trap", operands: 0, affects: [], cycles: "20" },
  BPT: { mnemonic: "BPT", description: "Breakpoint trap", operands: 0, affects: [], cycles: "48" },
  IOT: { mnemonic: "IOT", description: "I/O trap", operands: 0, affects: [], cycles: "48" },
  RESET: { mnemonic: "RESET", description: "Reset external bus", operands: 0, affects: [], cycles: "8" },
  NOP: { mnemonic: "NOP", description: "No operation", operands: 0, affects: [], cycles: "8" },
  CLC: { mnemonic: "CLC", description: "Clear carry", operands: 0, affects: ["C"], cycles: "8" },
  CLV: { mnemonic: "CLV", description: "Clear overflow", operands: 0, affects: ["V"], cycles: "8" },
  CLZ: { mnemonic: "CLZ", description: "Clear zero", operands: 0, affects: ["Z"], cycles: "8" },
  CLN: { mnemonic: "CLN", description: "Clear negative", operands: 0, affects: ["N"], cycles: "8" },
  CCC: { mnemonic: "CCC", description: "Clear all condition codes", operands: 0, affects: ["N", "Z", "V", "C"], cycles: "8" },
  SEC: { mnemonic: "SEC", description: "Set carry", operands: 0, affects: ["C"], cycles: "8" },
  SEV: { mnemonic: "SEV", description: "Set overflow", operands: 0, affects: ["V"], cycles: "8" },
  SEZ: { mnemonic: "SEZ", description: "Set zero", operands: 0, affects: ["Z"], cycles: "8" },
  SEN: { mnemonic: "SEN", description: "Set negative", operands: 0, affects: ["N"], cycles: "8" },
  SCC: { mnemonic: "SCC", description: "Set all condition codes", operands: 0, affects: ["N", "Z", "V", "C"], cycles: "8" }
};

export const DIRECTIVES = new Set([".LA", ".LINK", ".WORD", ".BYTE", ".ORG", ".EVEN", ".PRINT", ".RAD50", ".RADIX", ".ADDR", ".FLT2", ".FLT4", ".INSERT", ".INCLUDE", ".ASCII", ".ASCIZ", ".BLKB", ".BLKW", ".MACRO", ".SCRIPT", ".ENDM", ".END", ".ENDS", "EQU"]);
export const REGISTERS = new Set(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "SP", "PC", "%0", "%1", "%2", "%3", "%4", "%5", "%6", "%7"]);
