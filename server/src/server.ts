import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Definition,
  Diagnostic,
  DidChangeConfigurationNotification,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  ProposedFeatures,
  TextDocumentSyncKind
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver/node";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeProgram } from "./analyzer";
import { PDP11_INSTRUCTIONS, REGISTERS } from "./instructions";
import { parseProgram } from "./parser";
import { AssemblerKind, collectExternalAssemblerDiagnostics, ToolchainSettings } from "./toolchain";
import { SymbolEntry } from "./types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
const diagnosticsByUri = new Map<string, Diagnostic[]>();

const symbolIndex = new Map<string, { key: string; displayName: string; uri: string; line: number; start: number; end: number; scope?: string }>();
const analysisScopes = new Map<string, string[]>();
const documentSymbols = new Map<string, Map<string, SymbolEntry>>(); // Хранилище символов для каждого открытого документа
const documentScopes = new Map<string, string[]>();                  // Хранилище scopes для каждой строки каждого документа

let targetProfile = "BK-0010";
let toolchainSettings: ToolchainSettings = {
  enabled: false,
  selectedAssembler: "none",
  pdpy11Path: "pdpy11",
  bkturbo8Path: "bkturbo8",
  macro11Path: "macro11",
  extraArgs: [],
  timeoutMs: 5000
};

function getWordRange(document: TextDocument, line: number, character: number): { start: number; end: number } | null {
  const lineText = document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 }
  });
  const re = /[A-Za-z_.$@?][A-Za-z0-9_.$@?]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character <= end) {
      return { start, end };
    }
  }
  return null;
}

function isLocalSymbol(name: string): boolean {
  return (
    name.startsWith(".") ||
    /^[0-9]+\$?$/.test(name) ||
    name.endsWith("$") ||
    name.startsWith("@@")
  );
}

function normalizeName(name: string): string {
  return name.toUpperCase();
}

function normalizeUriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file:///")) {
    return undefined;
  }
  return decodeURIComponent(uri.replace("file:///", "")).replace(/\//g, path.sep);
}

// Функция для нахождения .include файла (поддержка с кавычками и без)
export function getIncludeFileLocation(document: TextDocument, line: number, character: number): Location | null {
  const lineText = document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 }
  });

  // Поддержка .include file.asm и .include "file.asm"
  const includeMatch = lineText.match(/^\s*\.include\s+(?:"([^"]+)"|(\S+))/i);
  if (!includeMatch) {
    return null;
  }

  const fileName = includeMatch[1] || includeMatch[2];
  if (!fileName) return null;

  // Проверяем, находится ли курсор внутри имени файла
  const matchStart = includeMatch.index || 0;
  const fileNameStart = lineText.indexOf(fileName, matchStart);
  const fileNameEnd = fileNameStart + fileName.length;

  if (character < fileNameStart || character > fileNameEnd) {
    return null;
  }

  const docPath = normalizeUriToPath(document.uri);
  if (!docPath) return null;

  const baseDir = path.dirname(docPath);
  const fullPath = path.resolve(baseDir, fileName);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileUri = `file:///${fullPath.replace(/\\/g, "/")}`;
  return Location.create(fileUri, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  });
}

function loadIncludes(document: TextDocument): Array<{ uri: string; text: string }> {
  const includes: Array<{ uri: string; text: string }> = [];
  const docPath = normalizeUriToPath(document.uri);
  if (!docPath) return includes;

  const baseDir = path.dirname(docPath);
  const text = document.getText();

  // Поддержка .include file.asm и .include "file.asm"
  const includeRegex = /^\s*\.include\s+(?:"([^"]+)"|(\S+))/gim;

  let match: RegExpExecArray | null;
  while ((match = includeRegex.exec(text)) !== null) {
    const fileName = match[1] || match[2];
    if (!fileName) continue;

    const fullPath = path.resolve(baseDir, fileName);
    if (fs.existsSync(fullPath)) {
      const fileText = fs.readFileSync(fullPath, "utf8");
      includes.push({
        uri: `file:///${fullPath.replace(/\\/g, "/")}`,
        text: fileText
      });
    }
  }
  return includes;
}

function computeLineScopes(programText: string): string[] {
  const parsed = parseProgram(programText);
  const scopes: string[] = [];
  let scope = "__FILE__";
  for (const stmt of parsed.statements) {
    if (stmt.label && !isLocalSymbol(stmt.label)) {
      scope = normalizeName(stmt.label);
    }
    scopes[stmt.line] = scope;
  }
  return scopes;
}

function mergeDiagnostics(uri: string, ...diagnosticSets: Diagnostic[][]): Diagnostic[] {
  const merged = diagnosticSets.flat().map((d) => ({
    ...d,
    source: d.source ?? "pdp11"
  }));
  diagnosticsByUri.set(uri, merged);
  return merged;
}

function rebuildSymbolIndex(mainUri: string, mainText: string, includes: Array<{ uri: string; text: string }>): void {
  // Очищаем только данные для текущего основного файла
  documentSymbols.delete(mainUri);
  documentScopes.delete(mainUri);

  // Парсим основной файл
  const mainProgram = parseProgram(mainText);
  const mainAnalysis = analyzeProgram(mainProgram, mainUri, targetProfile);
  const mainScopes = computeLineScopes(mainText);

  documentScopes.set(mainUri, mainScopes);
  documentSymbols.set(mainUri, mainAnalysis.symbols);

  // Добавляем include-файлы
  for (const inc of includes) {
    if (documentSymbols.has(inc.uri)) continue; // уже обработан

    const incProgram = parseProgram(inc.text);
    const incAnalysis = analyzeProgram(incProgram, inc.uri, targetProfile);

    documentSymbols.set(inc.uri, incAnalysis.symbols);
  }

  // Перестраиваем глобальный symbolIndex (для быстрого поиска)
  symbolIndex.clear();

  // Сначала символы из основного файла (с scoped ключами)
  for (const [key, entry] of mainAnalysis.symbols) {
    const lines = mainText.split(/\r?\n/);
    const lineText = lines[entry.line] ?? "";
    const start = Math.max(0, lineText.indexOf(entry.displayName));

    symbolIndex.set(key, {
      key,
      displayName: entry.displayName,
      uri: entry.uri,
      line: entry.line,
      start,
      end: start + entry.displayName.length,
      scope: entry.scope
    });
  }

  // Затем глобальные символы из всех include-файлов
  for (const [incUri, symbolsMap] of documentSymbols) {
    if (incUri === mainUri) continue;

    for (const [_, entry] of symbolsMap) {
      const globalKey = normalizeSymbolKey(entry.displayName);
      if (!symbolIndex.has(globalKey)) {
        const start = 0;

        symbolIndex.set(globalKey, {
          key: globalKey,
          displayName: entry.displayName,
          uri: entry.uri,
          line: entry.line,
          start,
          end: start + entry.displayName.length,
          scope: undefined
        });
      }
    }
  }
}

function normalizeSymbolKey(name: string): string {
  return name.toUpperCase();
}

function resolveSymbolKey(uri: string, line: number, symbol: string): string | undefined {
  const upper = normalizeName(symbol);

  // 1. Локальный символ в текущем файле (высший приоритет)
  if (isLocalSymbol(symbol)) {
    const scope = analysisScopes.get(uri)?.[line] ?? "__FILE__";
    const scopedKey = `${scope}::${upper}`;
    if (symbolIndex.has(scopedKey)) {
      return scopedKey;
    }
  }

  // 2. Глобальный символ (из основного файла или любого include)
  if (symbolIndex.has(upper)) {
    return upper;
  }

  // 3. Поиск по displayName
  for (const [key, entry] of symbolIndex) {
    if (entry.displayName.toUpperCase() === upper) {
      return key;
    }
  }
  return undefined;
}

async function validateDocument(document: TextDocument): Promise<void> {
  const mainText = document.getText();
  const includes = loadIncludes(document);

  const program = parseProgram(mainText);
  const analysis = analyzeProgram(program, document.uri, targetProfile);
  const externalDiagnostics = await collectExternalAssemblerDiagnostics(document.uri, toolchainSettings);
  const merged = mergeDiagnostics(document.uri, analysis.diagnostics, externalDiagnostics);

  connection.sendDiagnostics({ uri: document.uri, diagnostics: merged });

  // Перестраиваем индекс только для текущего документа + его includes
  rebuildSymbolIndex(document.uri, mainText, includes);
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!capabilities.workspace?.configuration;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
    }
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

connection.onDidChangeConfiguration(async (change) => {
  const cfg = (change.settings?.pdp11 ?? {}) as {
    targetProfile?: string;
    selectedAssembler?: AssemblerKind;
    enableAssemblerDiagnostics?: boolean;
    pdpy11Path?: string;
    bkturbo8Path?: string;
    assemblerArgs?: string[];
    assemblerTimeoutMs?: number;
  };

  targetProfile = cfg.targetProfile ?? "BK-0010";
  toolchainSettings = {
    enabled: cfg.enableAssemblerDiagnostics ?? false,
    selectedAssembler: cfg.selectedAssembler ?? "none",
    pdpy11Path: cfg.pdpy11Path ?? "pdpy11",
    bkturbo8Path: cfg.bkturbo8Path ?? "bkturbo8",
    macro11Path: (cfg as any).macro11Path ?? "macro11",
    extraArgs: cfg.assemblerArgs ?? [],
    timeoutMs: cfg.assemblerTimeoutMs ?? 5000
  };

  for (const doc of documents.all()) {
    await validateDocument(doc);
  }
});

documents.onDidOpen((e) => {
  void validateDocument(e.document);
});
documents.onDidChangeContent((e) => {
  void validateDocument(e.document);
});

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const wordRange = getWordRange(document, params.position.line, params.position.character);
  if (!wordRange) {
    return null;
  }
  const lineText = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line + 1, character: 0 }
  });
  const word = lineText.slice(wordRange.start, wordRange.end).toUpperCase();
  const meta = PDP11_INSTRUCTIONS[word];
  if (!meta) {
    return null;
  }
  return {
    contents: {
      kind: "markdown",
      value: `**${meta.mnemonic}**\n\n${meta.description}\n\n- Affects: ${meta.affects.join(", ") || "none"}\n- Cycles: ${meta.cycles}`
    }
  };
});

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: params.position.character }
  });
  const hasOpcode = /^\s*[A-Za-z_.@?$][A-Za-z0-9_.$@?]*/.test(line);

  const items: CompletionItem[] = [];
  if (!hasOpcode) {
    items.push(
      ...Object.keys(PDP11_INSTRUCTIONS).map((mnemonic) => ({
        label: mnemonic,
        kind: CompletionItemKind.Keyword,
        detail: PDP11_INSTRUCTIONS[mnemonic].description
      }))
    );
  } else {
    items.push(...Array.from(REGISTERS).map((reg) => ({ label: reg, kind: CompletionItemKind.Variable })));
    const seen = new Set<string>();
    for (const entry of symbolIndex.values()) {
      if (!seen.has(entry.displayName)) {
        seen.add(entry.displayName);
        items.push({ label: entry.displayName, kind: CompletionItemKind.Reference });
      }
    }
  }
  return items;
});

connection.onDefinition((params): Definition | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  // Проверка, находится ли курсор внутри .include директивы
  const includeLocation = getIncludeFileLocation(document, params.position.line, params.position.character);
  if (includeLocation) {
    return includeLocation;
  }

  const wordRange = getWordRange(document, params.position.line, params.position.character);
  if (!wordRange) {
    return null;
  }
  const lineText = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line + 1, character: 0 }
  });
  const symbol = lineText.slice(wordRange.start, wordRange.end);
  const symbolKey = resolveSymbolKey(params.textDocument.uri, params.position.line, symbol);
  if (!symbolKey) {
    return null;
  }
  const def = symbolIndex.get(symbolKey);
  if (!def) {
    return null;
  }
  return Location.create(def.uri, {
    start: { line: def.line, character: def.start },
    end: { line: def.line, character: def.end }
  });
});

// Реализация Find all References (Shift+F12) ====================
connection.onReferences((params): Location[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const wordRange = getWordRange(document, params.position.line, params.position.character);
  if (!wordRange) {
    return [];
  }

  const lineText = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line + 1, character: 0 }
  });

  const symbol = lineText.slice(wordRange.start, wordRange.end);
  const symbolKey = resolveSymbolKey(params.textDocument.uri, params.position.line, symbol);

  if (!symbolKey) {
    return [];
  }

  const locations: Location[] = [];

  // Ищем во всех открытых документах + include-файлах
  for (const [uri, text] of documents.all().map(doc => [doc.uri, doc.getText()])) {
    const program = parseProgram(text);
    // const analysis = analyzeProgram(program, uri, targetProfile);

    for (const stmt of program.statements) {
      for (const op of stmt.operands) {
        if (op.symbolName) {
          const candidateKey = resolveSymbolKey(uri, stmt.line, op.symbolName);
          if (candidateKey === symbolKey) {
            const range = {
              start: { line: stmt.line, character: op.range.start },
              end: { line: stmt.line, character: op.range.end }
            };
            locations.push(Location.create(uri, range));
          }
        }
      }

      // Также проверяем метки
      if (stmt.label) {
        const candidateKey = resolveSymbolKey(uri, stmt.line, stmt.label);
        if (candidateKey === symbolKey) {
          const range = {
            start: { line: stmt.line, character: 0 },
            end: { line: stmt.line, character: stmt.label.length }
          };
          locations.push(Location.create(uri, range));
        }
      }
    }
  }

  return locations;
});

documents.listen(connection);
connection.listen();
