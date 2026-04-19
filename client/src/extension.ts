import * as path from "node:path";
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient | undefined;
const CONFIG_SECTION = "pdp11";

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
    args = ["--implicit-bin", "-o", outputFile, ...extraArgs, filePath];
  } else if (assembler === "bkturbo8") {
    args = ["CO", "-o", outputFile, ...extraArgs, filePath];
  } else if (assembler === "macro11") {
    args = ["-o", outputFile, ...extraArgs, filePath];
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
        execFile(
          executable,
          args,
          {
            timeout: timeoutMs,
            windowsHide: true,
            cwd: path.dirname(filePath)
          },
          (error, stdout, stderr) => {
            const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
            if (error) {
              void vscode.window.showErrorMessage(`Assembler failed: ${output || error.message}`);
            } else {
              void vscode.window.showInformationMessage(`Assembled successfully with ${assembler}.`);
              if (output) {
                const channel = vscode.window.createOutputChannel(`${assembler} Output`);
                channel.appendLine(output);
                channel.show();
              }
            }
            resolve();
          }
        );
      });
    }
  );
}

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
    })
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}
