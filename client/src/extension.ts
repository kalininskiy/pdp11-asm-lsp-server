import * as path from "node:path";
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import * as cp from "node:child_process";
import * as fs from 'fs';
import iconv from "iconv-lite";

let client: LanguageClient | undefined;
const CONFIG_SECTION = "pdp11";
const outputChannels = new Map<string, vscode.OutputChannel>();

/**
 * Возвращает существующий или создаёт новый OutputChannel с заданным именем
 * 
 * @param name имя канала вывода
 * @returns 
 */
function getOutputChannel(name: string): vscode.OutputChannel {
  let channel = outputChannels.get(name);
  if (!channel) {
    channel = vscode.window.createOutputChannel(name);
    outputChannels.set(name, channel);
  }
  return channel;
}

/**
 * Позволяет пользователю выбрать исполняемый файл и сохраняет его путь в настройках
 * 
 * @param settingKey Ключ настройки
 * @param label Метка для диалога выбора файла
 * @returns 
 */
async function pickExecutableAndStore(settingKey: string, label: string): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectFiles: true,
    canSelectMany: false,
    title: label
  });
  const uri = picked?.[0];
  if (!uri) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update(settingKey, uri.fsPath, vscode.ConfigurationTarget.Workspace);
  void vscode.window.showInformationMessage(`${label}: ${uri.fsPath}`);
}

/**
 * Запускает указанный ассемблер с заданными аргументами
 * 
 * @param assembler Название ассемблера
 * @param pathKey Ключ настройки пути к исполняемому файлу
 * @returns 
 */
async function runAssembler(assembler: string, pathKey: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "pdp11-asm") {
    void vscode.window.showErrorMessage("No active PDP-11 assembly file.");
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const executable = cfg.get<string>(pathKey) || assembler;
  const extraArgs = cfg.get<string[]>("assemblerArgs") || [];
  const timeoutMs = cfg.get<number>("assemblerTimeoutMs") || 5000;

  // Build assembler-specific arguments
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputFile = path.join(path.dirname(filePath), `${baseName}.bin`);
  
  let args: string[] = [];
  if (assembler === "pdpy11") {
    args = ["--implicit-bin", ...extraArgs, filePath];
  } else if (assembler === "bkturbo8") {
    args = ["CO", ...extraArgs, filePath];
  } else if (assembler === "macro11") {
    args = [...extraArgs, filePath];
  } else {
    args = [...extraArgs, filePath];
  }

  const command = `${executable} ${args.join(' ')}`;
  console.log(`[DEBUG] Executing: ${command}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Assembling with ${assembler}...`,
      cancellable: false
    },
    async (progress) => {
      return new Promise<void>((resolve) => {
        const decodeBuffer = (buffer: Buffer | string | undefined): string => {
          if (!buffer) {
            return "";
          }
          const data = typeof buffer === "string" ? Buffer.from(buffer, "utf8") : buffer;
          if (assembler === "bkturbo8") {
            return iconv.decode(data, "cp1251");
          }
          return data.toString("utf8");
        };

        execFile(
          executable,
          args,
          {
            timeout: timeoutMs,
            windowsHide: true,
            cwd: path.dirname(filePath),
            encoding: "buffer"
          },
          (error, stdout, stderr) => {
            const stdoutText = decodeBuffer(stdout);
            const stderrText = decodeBuffer(stderr);
            const output = [stdoutText, stderrText].filter((text) => text.length > 0).join("\n\n").trim();

            if (error) {
              void vscode.window.showErrorMessage(`Assembler failed: ${output || error.message}`);
            } else {
              void vscode.window.showInformationMessage(`Assembled successfully with ${assembler}.`);

              const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
              const autoRun = cfg.get<boolean>("autoRunInEmulator") || false;

              if (autoRun) {
                // Небольшая задержка, чтобы .bin точно записался
                setTimeout(() => {
                  void runInEmulator(filePath);
                }, 300);
              }

              if (output) {
                const channel = getOutputChannel(`${assembler} Output`);
                channel.clear();
                channel.appendLine(output);
                channel.show(true);
              }
            }
            resolve();
          }
        );
      });
    }
  );
}

/**
 * Активирует расширение
 * 
 * @param context Контекст расширения
 */
export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "pdp11-asm" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{asm,s,mac}"),
      configurationSection: CONFIG_SECTION
    }
  };

  client = new LanguageClient("pdp11LanguageServer", "PDP-11 Language Server", serverOptions, clientOptions);
  void client.start();

  context.subscriptions.push(
    vscode.commands.registerCommand("pdp11.selectPdpy11Path", async () => {
      await pickExecutableAndStore("pdpy11Path", "Select pdpy11 executable");
    }),
    vscode.commands.registerCommand("pdp11.selectBkTurbo8Path", async () => {
      await pickExecutableAndStore("bkturbo8Path", "Select BKTurbo8 executable");
    }),
    vscode.commands.registerCommand("pdp11.selectMacro11Path", async () => {
      await pickExecutableAndStore("macro11Path", "Select MACRO11 executable");
    }),
    vscode.commands.registerCommand("pdp11.assembleWithPdpy11", async () => {
      await runAssembler("pdpy11", "pdpy11Path");
    }),
    vscode.commands.registerCommand("pdp11.assembleWithBkturbo8", async () => {
      await runAssembler("bkturbo8", "bkturbo8Path");
    }),
    vscode.commands.registerCommand("pdp11.assembleWithMacro11", async () => {
      await runAssembler("macro11", "macro11Path");
    }),
    vscode.commands.registerCommand("pdp11.pickEmulator", async () => {
        await pickExecutableAndStore("emulatorExecutable", "Select BK Emulator executable (BK_x64.exe - GiD)");
    })
  );
}

/**
 * Деактивирует расширение
 */
export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}

/**
 * Запускает указанный файл в эмуляторе
 * 
 * @param filePath Путь к файлу
 * @returns
 */
async function runInEmulator(filePath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("Нет открытого PDP-11 ASM файла");
        return;
    }

    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const emuPath = cfg.get<string>("emulatorExecutable") || "";
    const autoRun = cfg.get<boolean>("autoRunInEmulator") || false;

    if (!emuPath) {
        vscode.window.showErrorMessage("Не задан путь к эмулятору. Настройте pdp11.emulatorExecutable");
        return;
    }

    // const filePath = editor.document.uri.fsPath;
    const baseName = path.basename(filePath, path.extname(filePath));
    const binDir = path.dirname(filePath);
    const binPath = path.join(binDir, `${baseName}.bin`);

    if (!fs.existsSync(binPath)) {
        vscode.window.showErrorMessage(`Файл ${baseName}.bin не найден. Сначала соберите программу.`);
        return;
    }

    // Создаём временный скрипт автозагрузки для эмулятора, который загрузит собранный .bin файл
    const scriptsDir = path.join(path.dirname(emuPath), "Scripts");
    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

    const scriptPath = path.join(scriptsDir, "_autorun.bkscript");
    const scriptContent = `MO "${baseName}"\r\nm\r\n${baseName}\r\ns\r\n`;

    try {
        fs.writeFileSync(scriptPath, scriptContent, { encoding: 'utf8' });
    } catch (e) {
        vscode.window.showErrorMessage('Не удалось создать _autorun.bkscript');
        console.error(e);
        return;
    }

    // const cmd = `"${emuPath}" /C "BK-0010-01" /S "_autorun.bkscript"`;
    const cmd = `"${emuPath}" /C "BK-0010-01" /B "${binPath}"`;
    const emuDir = path.dirname(emuPath);
    
    const outputChannel = getOutputChannel('PDP-11 Emulator');
    outputChannel.clear();
    outputChannel.appendLine('Команда: ' + cmd);
    outputChannel.appendLine('Рабочая папка: ' + emuDir);
    outputChannel.appendLine('BIN файл: ' + binPath);
    outputChannel.show(true);

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Запуск ${baseName}.bin в эмуляторе...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                cp.exec(cmd, { cwd: path.dirname(emuPath) }, (error, stdout, stderr) => {
                    if (error) {
                        console.error('[PDP11 Emulator] Ошибка запуска:', error);
                        console.error('stdout:', stdout);
                        console.error('stderr:', stderr);
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
        });

        vscode.window.showInformationMessage(`Запущено в эмуляторе: ${baseName}.bin`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Ошибка запуска эмулятора: ${err.message}`);
    }
}
