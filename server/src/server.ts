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
  DocumentSymbol,
  SymbolKind,
  TextDocumentSyncKind,
  Range
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver/node";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeProgram } from "./analyzer";
import { PDP11_INSTRUCTIONS, REGISTERS } from "./instructions";
import { parseProgram } from "./parser";
import { AssemblerKind, collectExternalAssemblerDiagnostics, ToolchainSettings } from "./toolchain";
import { SymbolEntry, SourceRange } from "./types";

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

/**
 * Получает диапазон слова в текстовом документе
 * 
 * @param document Текстовый документ
 * @param line Номер строки
 * @param character Номер символа
 * @returns Диапазон слова или null, если слово не найдено
 */
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

/**
 * Функция для нахождения .include файла (поддержка с кавычками и без)
 * 
 * @param document Текстовый документ, в котором нужно найти .include
 * @param line Номер строки, на которой находится .include
 * @param character Номер символа, на котором находится курсор (для проверки, что он внутри имени файла)
 * @returns Объект Location, указывающий на местоположение файла .include, или null, если файл не найден
 */
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

/**
 * Загружает текст всех .include файлов, упомянутых в данном документе, и возвращает их в виде массива объектов с URI и текстом
 * 
 * @param document Текстовый документ, для которого нужно загрузить .include файлы
 * @returns Массив объектов с URI и текстом включенных файлов
 */
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

/**
 * Вычисляет scopes для каждой строки программы на основе меток и локальных символов
 * 
 * @param programText Текст программы, для которой нужно вычислить scopes
 * @returns Массив scopes для каждой строки программы
 */
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

/**
 * Merges diagnostics from multiple sources (internal analysis and external assembler) for a given document URI
 * 
 * @param uri The URI of the document for which diagnostics are being merged
 * @param diagnosticSets Multiple arrays of diagnostics to be merged together
 * @returns 
 */
function mergeDiagnostics(uri: string, ...diagnosticSets: Diagnostic[][]): Diagnostic[] {
  const merged = diagnosticSets.flat().map((d) => ({
    ...d,
    source: d.source ?? "pdp11"
  }));
  diagnosticsByUri.set(uri, merged);
  return merged;
}

/**
 * Rebuilds the symbol index for a given document and its included files
 * 
 * @param mainUri The URI of the main document being processed
 * @param mainText The text content of the main document
 * @param includes An array of included files with their URIs and text content
 */
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

/**
 * Resolves a symbol key based on its URI, line, and name
 * 
 * @param uri The URI of the document where the symbol is referenced
 * @param line The line number where the symbol is referenced
 * @param symbol The symbol name as it appears in the code (could be local or global)
 * @returns 
 */
function resolveSymbolKey(uri: string, line: number, symbol: string): string | undefined {
  if (!symbol) return undefined;

  // Убираем префикс @ 
  const cleanSymbol = symbol.replace(/^@+/, "").toUpperCase();

  // 1. Локальный символ
  if (isLocalSymbol(cleanSymbol)) {
    const scope = analysisScopes.get(uri)?.[line] ?? "__FILE__";
    const scopedKey = `${scope}::${cleanSymbol}`;
    if (symbolIndex.has(scopedKey)) {
      return scopedKey;
    }
  }

  // 2. Глобальный символ
  if (symbolIndex.has(cleanSymbol)) {
    return cleanSymbol;
  }

  // 3. Поиск по displayName
  for (const [key, entry] of symbolIndex) {
    if (entry.displayName.toUpperCase() === cleanSymbol) {
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
      documentSymbolProvider: true,
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

/**
 * Реализация Hover для отображения информации об инструкции при наведении курсора на мнемонику
 */
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

/**
 * Реализация автодополнения (Ctrl+Space)
 */
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

/**
 * Реализация Go to Definition (F12)
 */
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

/**
 * Реализация Find all References (Shift+F12)
 */
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

/**
 * Реализация Document Symbols для отображения структуры файла в панели Outline
 */
connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const program = parseProgram(doc.getText());

  const symbols: DocumentSymbol[] = [];
  const seen = new Set<string>();

  let currentContainer: DocumentSymbol | null = null;

  for (const stmt of program.statements) {
    // --- НАЧАЛО .SCRIPT ---
    if (stmt.directive === ".SCRIPT" && stmt.operands.length > 0) {
      const name = stmt.operands[0].text;

      const scriptSymbol: DocumentSymbol = {
        name,
        kind: SymbolKind.Namespace,
        range: toLspRange(stmt.range),
        selectionRange: toLspRange(stmt.range),
        children: [],
      };

      symbols.push(scriptSymbol);
      currentContainer = scriptSymbol;
      continue;
    }

    // --- НАЧАЛО .MACRO ---
    if (stmt.directive === ".MACRO" && stmt.operands.length > 0) {
      const name = stmt.operands[0].text;

      const macroSymbol: DocumentSymbol = {
        name,
        kind: SymbolKind.Function,
        range: toLspRange(stmt.range),
        selectionRange: toLspRange(stmt.range),
        children: [],
      };

      symbols.push(macroSymbol);
      currentContainer = macroSymbol;
      continue;
    }

    // --- КОНЕЦ БЛОКОВ ---
    if (
      stmt.directive === ".ENDS" ||
      stmt.directive === ".ENDM"
    ) {
      currentContainer = null;
      continue;
    }

    // --- .EQU ---
    if (
      stmt.directive === ".EQU" ||
      stmt.directive === "EQU"
    ) {
      if (stmt.label) {
        const constSymbol: DocumentSymbol = {
          name: `${stmt.label} = ${stmt.operands[0]?.text ?? ""}`,
          kind: SymbolKind.Constant,
          range: toLspRange(stmt.range),
          selectionRange: toLspRange(stmt.range),
        };

        if (currentContainer) {
          currentContainer.children!.push(constSymbol);
        } else {
          symbols.push(constSymbol);
        }
      }
      continue;
    }
    
    // --- LABEL ---
    if (stmt.label && !isLocalLabel(stmt.label)) {
      const key = `${stmt.label}@${stmt.range.line}`;

      if (seen.has(key)) continue;
      seen.add(key);

      const labelSymbol: DocumentSymbol = {
        name: stmt.label,
        kind: SymbolKind.Function,
        range: toLspRange(stmt.range),
        selectionRange: toLspRange(stmt.range),
      };

      if (currentContainer) {
        currentContainer.children!.push(labelSymbol);
      } else {
        symbols.push(labelSymbol);
      }
    }
  }

  return symbols;
});

function toLspRange(r: SourceRange): Range {
  return {
    start: { line: r.line, character: r.start },
    end: { line: r.line, character: r.end },
  };
}

function isLocalLabel(name: string): boolean {
  return /^\d+\$?$/.test(name);
}

documents.listen(connection);
connection.listen();
