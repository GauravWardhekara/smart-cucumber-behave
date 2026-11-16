import * as fs from "fs/promises";
import * as vscode from "vscode";
import { DEFAULT_STEP_DEFINITION_PATTERNS, parseStepDefinitionsFromPython } from "../core/pythonStepDecorators";
import { StepDefinition } from "../core/types";
import { settings } from "../settings";

export class StepDefinitionIndex {
  private fileMap = new Map<string, StepDefinition[]>();
  private definitions: StepDefinition[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  getDefinitions(): StepDefinition[] {
    return this.definitions;
  }

  private refreshDefinitions(): void {
    const list: StepDefinition[] = [];
    for (const defs of this.fileMap.values()) {
      list.push(...defs);
    }
    this.definitions = list;
    this._onDidChange.fire();
  }

  async updateFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = parseStepDefinitionsFromPython(filePath, content);
      this.fileMap.set(filePath, parsed);
    } catch {
      this.fileMap.delete(filePath);
    }
    this.refreshDefinitions();
  }

  removeFile(filePath: string): void {
    if (this.fileMap.delete(filePath)) {
      this.refreshDefinitions();
    }
  }

  async rebuild(): Promise<void> {
    const nextMap = new Map<string, StepDefinition[]>();
    const patterns = settings.stepDefinitionsPatterns() || DEFAULT_STEP_DEFINITION_PATTERNS;

    for (const pattern of patterns) {
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const uri of uris) {
        const filePath = uri.fsPath;
        if (nextMap.has(filePath)) {
          continue;
        }
        try {
          const content = await fs.readFile(filePath, "utf-8");
          nextMap.set(filePath, parseStepDefinitionsFromPython(filePath, content));
        } catch {
          // ignore unreadable files
        }
      }
    }

    this.fileMap = nextMap;
    this.refreshDefinitions();
  }

  registerWatcher(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.py");
    let timer: NodeJS.Timeout | undefined;

    const scheduleUpdate = (uri: vscode.Uri) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.updateFile(uri.fsPath);
      }, 150);
    };

    const scheduleDelete = (uri: vscode.Uri) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.removeFile(uri.fsPath);
      }, 150);
    };

    context.subscriptions.push(
      watcher,
      watcher.onDidChange(scheduleUpdate),
      watcher.onDidCreate(scheduleUpdate),
      watcher.onDidDelete(scheduleDelete),
      {
        dispose: () => {
          clearTimeout(timer);
          this._onDidChange.dispose();
          this._onDidChange = new vscode.EventEmitter<void>();
        },
      }
    );

    void this.rebuild();
  }
}

export const stepDefinitionIndex = new StepDefinitionIndex();
