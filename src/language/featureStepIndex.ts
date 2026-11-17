import * as fs from "fs/promises";
import * as vscode from "vscode";
import { behavePatternToRegex } from "../core/stepMatcher";
import { extractFeatureStepsFromContent } from "../core/featureSteps";
import { FeatureStep, StepKeyword } from "../core/types";
import { settings } from "../settings";

export class FeatureStepIndex {
  private fileMap = new Map<string, FeatureStep[]>();
  private steps: FeatureStep[] = [];
  private regexCache = new Map<string, RegExp>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  getSteps(): FeatureStep[] {
    return this.steps;
  }

  findMatchingSteps(pattern: string, keyword?: StepKeyword): FeatureStep[] {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = behavePatternToRegex(pattern);
      if (this.regexCache.size > 2000) {
        this.regexCache.clear();
      }
      this.regexCache.set(pattern, regex);
    }

    return this.steps.filter((step) => {
      if (keyword && keyword !== "step") {
        if (step.effectiveKeyword !== keyword) {
          return false;
        }
      }
      return regex!.test(step.text.trim());
    });
  }

  private refreshSteps(): void {
    this.regexCache.clear();
    const list: FeatureStep[] = [];
    for (const fileSteps of this.fileMap.values()) {
      list.push(...fileSteps);
    }
    this.steps = list;
    this._onDidChange.fire();
  }

  async updateFile(filePath: string): Promise<void> {
    if (!filePath.endsWith(".feature")) return;
    try {
      const content = await fs.readFile(filePath, "utf-8");
      this.fileMap.set(filePath, extractFeatureStepsFromContent(filePath, content));
    } catch {
      this.fileMap.delete(filePath);
    }
    this.refreshSteps();
  }

  removeFile(filePath: string): void {
    if (this.fileMap.delete(filePath)) {
      this.refreshSteps();
    }
  }

  async rebuild(): Promise<void> {
    this.regexCache.clear();
    const nextMap = new Map<string, FeatureStep[]>();
    const patterns = settings.featureFilesPatterns() || ["**/*.feature"];

    for (const pattern of patterns) {
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const uri of uris) {
        const filePath = uri.fsPath;
        if (!filePath.endsWith(".feature") || nextMap.has(filePath)) {
          continue;
        }
        try {
          const content = await fs.readFile(filePath, "utf-8");
          nextMap.set(filePath, extractFeatureStepsFromContent(filePath, content));
        } catch {
          // skip unreadable
        }
      }
    }

    this.fileMap = nextMap;
    this.refreshSteps();
  }

  registerWatcher(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
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

export const featureStepIndex = new FeatureStepIndex();
