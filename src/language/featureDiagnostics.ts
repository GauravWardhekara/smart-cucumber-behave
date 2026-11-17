import * as vscode from "vscode";
import { analyzeFeatureDocument } from "../core/featureSemanticTokens";
import { stepDefinitionIndex } from "./stepIndex";
import { settings } from "../settings";

export class BehaveDiagnosticsManager {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("behave");
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.diagnosticCollection);

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "feature" || e.document.fileName.endsWith(".feature")) {
          this.scheduleUpdateDiagnostics(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
          this.updateDiagnostics(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const timer = this.debounceTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(key);
        }
        this.diagnosticCollection.delete(doc.uri);
      })
    );

    context.subscriptions.push(
      stepDefinitionIndex.onDidChange(() => {
        for (const doc of vscode.workspace.textDocuments) {
          if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
            this.scheduleUpdateDiagnostics(doc);
          }
        }
      })
    );

    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
        this.updateDiagnostics(doc);
      }
    }
  }

  scheduleUpdateDiagnostics(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.updateDiagnostics(document);
    }, 250);
    this.debounceTimers.set(key, timer);
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    const suppressDuplicates = settings.suppressDuplicateBehaveWarnings(document.uri);
    if (suppressDuplicates) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const text = document.getText();
    const definitions = stepDefinitionIndex.getDefinitions();
    const analysis = analyzeFeatureDocument(text, definitions);

    const diagnostics: vscode.Diagnostic[] = analysis.undefinedStepDiagnostics.map((d) => {
      const range = new vscode.Range(d.line, d.startCharacter, d.line, d.endCharacter);
      const diagnostic = new vscode.Diagnostic(
        range,
        d.message,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "Behave";
      diagnostic.code = d.code;
      return diagnostic;
    });

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}

export const behaveDiagnosticsManager = new BehaveDiagnosticsManager();
