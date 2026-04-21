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

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
const diagnosticsByUri = new Map<string, Diagnostic[]>();

const symbolIndex = new Map<string, { key: string; displayName: string; uri: string; line: number; start: number; end: number; scope?: string }>();
const analysisScopes = new Map<string, string[]>();

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

// Функция для нахождения .include файла, если курсор находится внутри .INCLUDE директивы
export function getIncludeFileLocation(document: TextDocument, line: number, character: number): Location | null {
  const lineText = document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 }
  });

  // Проверим, является ли строка директивой .include
  const includeMatch = lineText.match(/^\s*\.include\s+"([^"]+)"/i);
  if (!includeMatch) {
    return null;
  }

  const fileName = includeMatch[1];
  const docPath = normalizeUriToPath(document.uri);
  if (!docPath) {
    return null;
  }

  // Позиция имени файла в строке
  const fileNameStart = lineText.indexOf(`"${fileName}"`);
  const fileNameEnd = fileNameStart + fileName.length + 2; // +2 для кавычек

  // Проверка, находится ли курсор внутри имени файла
  if (character < fileNameStart || character > fileNameEnd) {
    return null;
  }

  const baseDir = path.dirname(docPath);
  const fullPath = path.resolve(baseDir, fileName);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  // Найденный location для файла
  const fileUri = `file:///${fullPath.replace(/\\/g, "/")}`;
  return Location.create(fileUri, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  });
}

function loadIncludes(document: TextDocument): Array<{ uri: string; text: string }> {
  const includes: Array<{ uri: string; text: string }> = [];
  const docPath = normalizeUriToPath(document.uri);
  if (!docPath) {
    return includes;
  }
  const baseDir = path.dirname(docPath);
  const includeMatches = document.getText().matchAll(/^\s*\.include\s+"([^"]+)"/gim);
  for (const m of includeMatches) {
    const rel = m[1];
    const fullPath = path.resolve(baseDir, rel);
    if (fs.existsSync(fullPath)) {
      const text = fs.readFileSync(fullPath, "utf8");
      includes.push({ uri: `file:///${fullPath.replace(/\\/g, "/")}`, text });
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

function rebuildSymbolIndex(sourceTexts: Array<{ uri: string; text: string }>): void {
  symbolIndex.clear();
  analysisScopes.clear();

  for (const source of sourceTexts) {
    const program = parseProgram(source.text);
    const analysis = analyzeProgram(program, source.uri, targetProfile);
    const scopes = computeLineScopes(source.text);
    analysisScopes.set(source.uri, scopes);

    for (const [key, entry] of analysis.symbols) {
      const lines = source.text.split(/\r?\n/);
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
  }
}

function resolveSymbolKey(uri: string, line: number, symbol: string): string | undefined {
  const upper = normalizeName(symbol);
  const scope = analysisScopes.get(uri)?.[line] ?? "__FILE__";
  if (isLocalSymbol(symbol)) {
    const scoped = `${scope}::${upper}`;
    if (symbolIndex.has(scoped)) {
      return scoped;
    }
    return undefined;
  }
  if (symbolIndex.has(upper)) {
    return upper;
  }
  for (const [key, entry] of symbolIndex) {
    if (entry.displayName.toUpperCase() === upper) {
      return key;
    }
  }
  return undefined;
}

async function validateDocument(document: TextDocument): Promise<void> {
  const program = parseProgram(document.getText());
  const analysis = analyzeProgram(program, document.uri, targetProfile);
  const includes = loadIncludes(document);
  const externalDiagnostics = await collectExternalAssemblerDiagnostics(document.uri, toolchainSettings);
  const merged = mergeDiagnostics(document.uri, analysis.diagnostics, externalDiagnostics);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: merged });
  rebuildSymbolIndex([{ uri: document.uri, text: document.getText() }, ...includes]);
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!capabilities.workspace?.configuration;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false },
      hoverProvider: true,
      definitionProvider: true
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

documents.listen(connection);
connection.listen();
