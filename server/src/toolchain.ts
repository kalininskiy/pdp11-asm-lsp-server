import * as path from "node:path";
import { execFile } from "node:child_process";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

/**
 * Тип для представления поддерживаемых ассемблеров, которые могут быть выбраны пользователем в настройках расширения
 */
export type AssemblerKind = "none" | "pdpy11" | "bkturbo8" | "macro11";

/**
 * Интерфейс для представления настроек инструментов сборки, которые могут быть настроены пользователем в настройках расширения
 */
export interface ToolchainSettings {
  enabled: boolean;
  selectedAssembler: AssemblerKind;
  pdpy11Path: string;
  bkturbo8Path: string;
  macro11Path: string;
  extraArgs: string[];
  timeoutMs: number;
}

/**
 * Интерфейс для представления адаптера ассемблера
 */
interface AssemblerAdapter {
  kind: Exclude<AssemblerKind, "none">;
  parseOutput(raw: string): Diagnostic[];
}

/**
 * Значение таймаута по умолчанию в миллисекундах
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Создает диагностическое сообщение, связанное с конкретной строкой в коде
 * 
 * @param message Текст сообщения диагностики
 * @param line Номер строки, к которой относится диагностика (1-индексация)
 * @param severity Уровень серьезности диагностики (ошибка, предупреждение и т.д.)
 * @param source Источник диагностики (например, имя ассемблера)
 * @param character Номер символа в строке, к которому относится диагностика (1-индексация, по умолчанию 1)
 * @returns Объект Diagnostic, который может быть возвращен в LSP-сервере для отображения пользователю
 */
function toLineDiagnostic(
  message: string,
  line: number,
  severity: DiagnosticSeverity,
  source: string,
  character = 0
): Diagnostic {
  const safeLine = Math.max(0, line - 1);
  const safeChar = Math.max(0, character - 1);
  return {
    message,
    severity,
    source,
    range: {
      start: { line: safeLine, character: safeChar },
      end: { line: safeLine, character: safeChar + 1 }
    }
  };
}

/**
 * Парсит вывод ассемблера и преобразует его в массив диагностических сообщений
 * 
 * @param raw Вывод ассемблера
 * @param source Источник диагностики
 * @returns Массив диагностических сообщений
 */
function parseGenericAssemblerOutput(raw: string, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const fileStyle = trimmed.match(/^(?:.+?:)?(\d+)(?::(\d+))?\s*:\s*(error|warning)\s*:?\s*(.+)$/i);
    if (fileStyle) {
      diagnostics.push(
        toLineDiagnostic(
          fileStyle[4].trim(),
          Number.parseInt(fileStyle[1], 10),
          fileStyle[3].toLowerCase() === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
          source,
          fileStyle[2] ? Number.parseInt(fileStyle[2], 10) : 1
        )
      );
      continue;
    }

    const lineStyle = trimmed.match(/^line\s+(\d+)\s*[:\-]\s*(error|warning)?\s*:?\s*(.+)$/i);
    if (lineStyle) {
      diagnostics.push(
        toLineDiagnostic(
          lineStyle[3].trim(),
          Number.parseInt(lineStyle[1], 10),
          (lineStyle[2] ?? "error").toLowerCase() === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
          source
        )
      );
      continue;
    }
  }

  return diagnostics;
}

/**
 * Адаптер для ассемблера pdpy11, который парсит его вывод и преобразует его в диагностические сообщения для LSP-сервера
 */
const pdpy11Adapter: AssemblerAdapter = {
  kind: "pdpy11",
  parseOutput(raw) {
    return parseGenericAssemblerOutput(raw, "pdpy11");
  }
};

/**
 * Адаптер для ассемблера BKTurbo8, который парсит его вывод и преобразует его в диагностические сообщения для LSP-сервера
 */
const bkturbo8Adapter: AssemblerAdapter = {
  kind: "bkturbo8",
  parseOutput(raw) {
    return parseGenericAssemblerOutput(raw, "BKTurbo8");
  }
};

/**
 * Адаптер для ассемблера MACRO-11, который парсит его вывод и преобразует его в диагностические сообщения для LSP-сервера
 */
const macro11Adapter: AssemblerAdapter = {
  kind: "macro11",
  parseOutput(raw) {
    return parseGenericAssemblerOutput(raw, "MACRO11");
  }
};

/**
 * Таблица адаптеров для ассемблеров
 */
const ADAPTERS: Record<Exclude<AssemblerKind, "none">, AssemblerAdapter> = {
  pdpy11: pdpy11Adapter,
  bkturbo8: bkturbo8Adapter,
  macro11: macro11Adapter
};

/**
 * Преобразует URI в путь к файлу в файловой системе
 * 
 * @param uri URI файла
 * @returns Путь к файлу в файловой системе или undefined, если URI недействителен
 */
function uriToFsPath(uri: string): string | undefined {
  if (!uri.startsWith("file:///")) {
    return undefined;
  }
  const decoded = decodeURIComponent(uri.replace("file:///", ""));
  return decoded.replace(/\//g, path.sep);
}

/**
 * Выполняет ассемблер с заданными аргументами
 * 
 * @param executable Путь к исполняемому файлу ассемблера
 * @param args Аргументы командной строки
 * @param timeoutMs Таймаут выполнения
 * @returns Объект с выводом ассемблера и флагом, указывающим, завершился ли процесс с ошибкой
 */
function executeAssembler(executable: string, args: string[], timeoutMs: number): Promise<{ output: string; failed: boolean }> {
  const command = `${executable} ${args.join(' ')}`;
  console.error(`[DEBUG] Executing assembler: ${command}`);
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      {
        timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
        if (error) {
          resolve({ output, failed: true });
          return;
        }
        resolve({ output, failed: false });
      }
    );
  });
}

/**
 * Собирает диагностические сообщения от внешнего ассемблера
 * 
 * @param uri URI файла
 * @param settings Настройки инструментария
 * @returns Массив диагностических сообщений
 */
export async function collectExternalAssemblerDiagnostics(uri: string, settings: ToolchainSettings): Promise<Diagnostic[]> {
  // Диагностика запуска ассемблера по умолчанию отключена для производительности.
  // Она полезна для проверки синтаксиса, но может быть ресурсоёмкой.
  // Включите в настройках: pdp11.enableAssemblerDiagnostics = true
  if (!settings.enabled || settings.selectedAssembler === "none") {
    return [];
  }
  const adapter = ADAPTERS[settings.selectedAssembler];
  if (!adapter) {
    return [];
  }
  const filePath = uriToFsPath(uri);
  if (!filePath) {
    return [];
  }

  // Генерируем команду запуска с правильными аргументами
  const baseName = path.basename(filePath, path.extname(filePath));
  const dir = path.dirname(filePath);
  const outputFile = path.join(dir, `${baseName}.bin`);
  
  let executable = "";
  let args: string[] = [];
  
  switch (settings.selectedAssembler) {
    case "pdpy11":
      executable = settings.pdpy11Path || "pdpy11";
      args = ["--implicit-bin", ...settings.extraArgs, filePath];
      break;
    case "bkturbo8":
      executable = settings.bkturbo8Path || "bkturbo8";
      args = ["CO", ...settings.extraArgs, filePath];
      break;
    case "macro11":
      executable = settings.macro11Path || "macro11";
      args = [...settings.extraArgs, filePath];
      break;
    default:
      return [];
  }

  const result = await executeAssembler(executable, args, settings.timeoutMs);
  const parsed = adapter.parseOutput(result.output);

  if (parsed.length > 0) {
    return parsed;
  }
  if (result.failed) {
    return [
      {
        message: `Failed to run '${executable}'. Check path and arguments in pdp11 settings.`,
        severity: DiagnosticSeverity.Warning,
        source: adapter.kind,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        }
      }
    ];
  }

  return [];
}
