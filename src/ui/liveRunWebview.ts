import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "../log";
import {
  setLiveRunPanelGateway,
  type LiveRunPanelGateway,
  getBehaveHierarchyStoreRef
} from "../run/behaveRunnerContext";
import {
  cancelActiveBehaveRun,
  isBehaveRunActive,
  logBehaveRunCancel
} from "../run/behaveRunCancellation";
import {
  isLivePanelFromWebviewMessage,
  LIVE_PANEL_PROTOCOL_VERSION,
  type LivePanelToWebviewMessage
} from "./livePanelProtocol";
import { parseFeatureFile } from "../core/featureParser";
import { detectConfigFiles } from "../run/behaveConfigFile";
import { settings } from "../settings";
import {
  getFeatureHierarchyNodeForPath,
  getScenarioNodeAtLine
} from "../run/behaveHierarchyQueries";
import {
  resolveBehaveFeatureChildrenIfNeeded,
  type BehaveHierarchyNode
} from "../run/behaveHierarchyModel";
import { runBehaveHierarchySelection } from "../run/behaveRunExecution";
import { behaveResultsManager } from "../run/behaveResultsManager";

export const PRIMARY_LIVE_RUN_VIEW_TYPE = "smartBehave.liveRun";

const LIVE_PANEL_CAPTURE_KEY = "behaveRunner.livePanelCapture.v1";
const MAX_CAPTURE_JSON_BYTES = 750_000;

let workspaceStateForLivePanel: vscode.Memento | undefined;
let livePanelCapture: unknown[] = [];
let activeWebviewView: vscode.WebviewView | undefined;

export interface DiscoveredStep {
  keyword: string;
  text: string;
  line: number;
}

export interface DiscoveredScenario {
  name: string;
  line: number;
  isOutline: boolean;
  steps: DiscoveredStep[];
}

export interface DiscoveredFeature {
  name: string;
  filePath: string;
  relativeFilePath: string;
  line: number;
  scenarios: DiscoveredScenario[];
}

export interface DiscoveryPayload {
  features: DiscoveredFeature[];
  capsFiles: string[];
  defaultConfig?: string;
  isRunning: boolean;
}

/** Opens the activity bar / primary side bar view (e.g. when starting Run/Debug). */
export async function revealLiveRunPanel(): Promise<void> {
  try {
    await vscode.commands.executeCommand("smartBehave.liveRun.focus");
  } catch {
    /* view not ready */
  }
}

export function notifyActiveWebview(message: LivePanelToWebviewMessage): void {
  if (activeWebviewView) {
    void activeWebviewView.webview.postMessage(message);
  }
}

function cloneForCapture(message: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(message)) as unknown;
  } catch {
    return message;
  }
}

function trimMessagesForStorage(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }
    const o = msg as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...o };
    if (typeof copy.logText === "string" && copy.logText.length > 8000) {
      copy.logText =
        copy.logText.slice(0, 8000) +
        "\n… [Behave Runner: truncated for storage]";
    }
    if (typeof copy.error === "string" && copy.error.length > 16000) {
      copy.error =
        copy.error.slice(0, 16000) + "\n… [Behave Runner: truncated]";
    }
    if (typeof copy.text === "string" && copy.text.length > 12000) {
      copy.text =
        copy.text.slice(0, 12000) + "\n… [Behave Runner: truncated]";
    }
    return copy;
  });
}

function shrinkCaptureIfNeeded(messages: unknown[]): unknown[] {
  let data = trimMessagesForStorage(messages);
  let json = JSON.stringify(data);
  if (json.length <= MAX_CAPTURE_JSON_BYTES) {
    return data;
  }
  data = messages.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }
    const o = msg as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...o };
    if (typeof copy.logText === "string") {
      copy.logText = `${copy.logText.slice(0, 400)}\n… [truncated]`;
    }
    if (typeof copy.error === "string") {
      copy.error = `${copy.error.slice(0, 400)}\n… [truncated]`;
    }
    if (typeof copy.text === "string") {
      copy.text = `${copy.text.slice(0, 400)}\n… [truncated]`;
    }
    return copy;
  });
  json = JSON.stringify(data);
  while (json.length > MAX_CAPTURE_JSON_BYTES) {
    const prevLen = data.length;
    data = data.filter((m, i) => {
      if (i === 0) {
        return true;
      }
      return (
        typeof m !== "object" ||
        m === null ||
        (m as { type?: string }).type !== "step_log_append"
      );
    });
    if (data.length === prevLen) {
      break;
    }
    json = JSON.stringify(data);
  }
  return data;
}

function persistLivePanelCaptureNowImpl(): void {
  const memento = workspaceStateForLivePanel;
  if (!memento || livePanelCapture.length <= 1) {
    return;
  }
  try {
    const data = shrinkCaptureIfNeeded(livePanelCapture);
    const json = JSON.stringify(data);
    if (json.length > MAX_CAPTURE_JSON_BYTES) {
      return;
    }
    void memento.update(LIVE_PANEL_CAPTURE_KEY, data);
  } catch {
    /* ignore */
  }
}

function createLivePanelGateway(
  postToWebview: (message: LivePanelToWebviewMessage) => void
): LiveRunPanelGateway {
  return {
    post(message: LivePanelToWebviewMessage): void {
      livePanelCapture.push(cloneForCapture(message));
      postToWebview(message);
    },
    clear(): void {
      livePanelCapture = [{ type: "clear" }];
      postToWebview({ type: "clear" });
    },
    persistCapture(): void {
      persistLivePanelCaptureNowImpl();
    }
  };
}

/**
 * Scans workspace folders to discover all features, scenarios, steps, and caps config files.
 */
export async function collectDiscoveryData(): Promise<DiscoveryPayload> {
  const wsFolders = vscode.workspace.workspaceFolders ?? [];
  const features: DiscoveredFeature[] = [];
  const capsFilesSet = new Set<string>();
  let defaultConfig: string | undefined;

  for (const folder of wsFolders) {
    const root = folder.uri.fsPath;
    const detected = detectConfigFiles(root);
    for (const c of detected) {
      capsFilesSet.add(c);
    }
    const def = settings.defaultConfigFile(folder.uri)?.trim();
    if (def) {
      defaultConfig = def;
    }

    try {
      const pattern = new vscode.RelativePattern(folder, "**/*.feature");
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const uri of uris) {
        try {
          const content = fs.readFileSync(uri.fsPath, "utf-8");
          const parsed = parseFeatureFile(uri.fsPath, content);
          const relPath = path.relative(root, uri.fsPath).replace(/\\/g, "/");
          const scenarios: DiscoveredScenario[] = (parsed.scenarios || []).map((sc) => ({
            name: sc.name,
            line: sc.line,
            isOutline: sc.isOutline,
            steps: (sc.steps || []).map((st) => ({
              keyword: st.keyword,
              text: st.text,
              line: st.line
            }))
          }));

          features.push({
            name: parsed.name || path.basename(uri.fsPath, ".feature"),
            filePath: uri.fsPath,
            relativeFilePath: relPath,
            line: parsed.line,
            scenarios
          });
        } catch (err) {
          LOG.warn("Could not parse feature for discovery:", uri.fsPath, err);
        }
      }
    } catch (findErr) {
      LOG.warn("Could not find feature files in folder:", root, findErr);
    }
  }

  features.sort((a, b) => {
    const aInFeatures = a.relativeFilePath.startsWith("features/");
    const bInFeatures = b.relativeFilePath.startsWith("features/");
    if (aInFeatures && !bInFeatures) return -1;
    if (!aInFeatures && bInFeatures) return 1;
    return a.relativeFilePath.localeCompare(b.relativeFilePath);
  });

  if (!defaultConfig && capsFilesSet.size > 0) {
    defaultConfig = Array.from(capsFilesSet)[0];
  }

  return {
    features,
    capsFiles: Array.from(capsFilesSet).sort(),
    defaultConfig,
    isRunning: isBehaveRunActive()
  };
}

async function postDiscoveryDataToWebview(webview: vscode.Webview): Promise<void> {
  const payload = await collectDiscoveryData();
  void webview.postMessage({
    type: "discoveryData",
    payload
  });
}

function postResultsDataToWebview(webview: vscode.Webview): void {
  const records = behaveResultsManager.getRecords();
  const summary = behaveResultsManager.getSummary();
  void webview.postMessage({
    type: "resultsData",
    records,
    summary
  });
}

export function registerLiveRunWebview(context: vscode.ExtensionContext): void {
  workspaceStateForLivePanel = context.workspaceState;
  const provider = new LiveRunWebviewProvider(context.extensionUri);

  try {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(PRIMARY_LIVE_RUN_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
  } catch (err) {
    LOG.warn("Failed to register primary liveRun view provider:", err);
  }

  // Watch for test results changes and forward to webview
  context.subscriptions.push(
    behaveResultsManager.onDidChange(() => {
      if (activeWebviewView) {
        postResultsDataToWebview(activeWebviewView.webview);
      }
    })
  );

  // Watch for feature file changes to keep discovery up-to-date
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => {
      if (activeWebviewView) void postDiscoveryDataToWebview(activeWebviewView.webview);
    }),
    watcher.onDidChange(() => {
      if (activeWebviewView) void postDiscoveryDataToWebview(activeWebviewView.webview);
    }),
    watcher.onDidDelete(() => {
      if (activeWebviewView) void postDiscoveryDataToWebview(activeWebviewView.webview);
    })
  );
}

function loadLiveRunHtml(extensionUri: vscode.Uri): string {
  const filePath = path.join(extensionUri.fsPath, "media", "liveRunPanel.html");
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:12px">Cucumber-Behave: could not read <code>media/liveRunPanel.html</code>.</body></html>`;
  }
}

function buildLiveRunPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  let html = loadLiveRunHtml(extensionUri);
  const codiconCss = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "codicons", "codicon.css")
  );
  const bundledJs = vscode.Uri.joinPath(
    extensionUri,
    "media",
    "liveRunPanel.bundle.js"
  );
  const useBundle = fs.existsSync(bundledJs.fsPath);
  const scriptSrc = useBundle ? webview.asWebviewUri(bundledJs).toString() : "";
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'unsafe-inline'`
  ].join("; ");

  html = html.replace("BEHAVE_RUN_CSP_PLACEHOLDER", csp);
  html = html.replace(
    "BEHAVE_RUN_CODICON_LINK_PLACEHOLDER",
    `<link rel="stylesheet" href="${codiconCss}" />`
  );
  html = html.replace(
    "BEHAVE_RUN_SCRIPT_PLACEHOLDER",
    useBundle
      ? `<script src="${scriptSrc}"></script>`
      : ""
  );
  return html;
}

class LiveRunWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private webviewMessageDisposable?: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewMessageDisposable?.dispose();
    this.webviewMessageDisposable = undefined;

    this.view = webviewView;
    activeWebviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = buildLiveRunPanelHtml(
      webviewView.webview,
      this.extensionUri
    );

    const gateway = createLivePanelGateway((msg) => {
      void webviewView.webview.postMessage(msg);
    });
    setLiveRunPanelGateway(gateway);

    this.webviewMessageDisposable = webviewView.webview.onDidReceiveMessage(
      (msg: unknown) => {
        void handleLiveRunWebviewMessage(webviewView.webview, msg);
      }
    );

    webviewView.onDidDispose(() => {
      this.webviewMessageDisposable?.dispose();
      this.webviewMessageDisposable = undefined;
      if (this.view === webviewView) {
        setLiveRunPanelGateway(undefined);
        this.view = undefined;
        if (activeWebviewView === webviewView) {
          activeWebviewView = undefined;
        }
      }
    });
  }
}

function postStoredLivePanelReplay(webview: vscode.Webview): void {
  const memento = workspaceStateForLivePanel;
  if (!memento) {
    return;
  }
  const saved = memento.get<unknown[]>(LIVE_PANEL_CAPTURE_KEY);
  if (!Array.isArray(saved) || saved.length === 0) {
    return;
  }
  const replay: LivePanelToWebviewMessage = {
    type: "replayCapture",
    messages: saved
  };
  void webview.postMessage(replay);
}

async function handleRunTestFromWebview(
  webview: vscode.Webview,
  msg: {
    filePath: string;
    scenarioName?: string;
    scenarioLine?: number;
    capsFile?: string;
  }
): Promise<void> {
  if (isBehaveRunActive()) {
    void vscode.window.showWarningMessage(
      "A test execution is already in progress. Please stop it before launching a new one."
    );
    return;
  }

  const store = getBehaveHierarchyStoreRef();
  if (!store) {
    void vscode.window.showErrorMessage("Cucumber-Behave: Test store is not ready.");
    return;
  }

  const featureNode = await getFeatureHierarchyNodeForPath(store, msg.filePath);
  if (!featureNode) {
    void vscode.window.showErrorMessage(
      `Cucumber-Behave: Feature not found for ${path.basename(msg.filePath)}`
    );
    return;
  }

  let nodesToRun: BehaveHierarchyNode[] = [featureNode];
  if (msg.scenarioName || typeof msg.scenarioLine === "number") {
    await resolveBehaveFeatureChildrenIfNeeded(featureNode);
    let targetScenario: BehaveHierarchyNode | undefined;
    if (typeof msg.scenarioLine === "number") {
      targetScenario = await getScenarioNodeAtLine(store, msg.filePath, msg.scenarioLine);
    }
    if (!targetScenario && msg.scenarioName) {
      for (const ch of featureNode.children.values()) {
        if (ch.label === msg.scenarioName || ch.label.includes(msg.scenarioName)) {
          targetScenario = ch;
          break;
        }
      }
    }
    if (targetScenario) {
      nodesToRun = [targetScenario];
    }
  }

  // Switch webview to Execution tab
  void webview.postMessage({
    type: "switchToTab",
    tab: "execution"
  });

  const cts = new vscode.CancellationTokenSource();
  try {
    await runBehaveHierarchySelection(
      nodesToRun,
      cts.token,
      msg.capsFile || undefined
    );
  } finally {
    cts.dispose();
  }
}

async function handleOpenFileFromWebview(filePath: string, line?: number): Promise<void> {
  if (!filePath) return;
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const line0 = Math.max(0, Math.min((line ?? 0), doc.lineCount - 1));
    const pos = doc.lineAt(line0).range.start;
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Selection(pos, pos),
      preserveFocus: false,
      preview: false
    });
  } catch (err) {
    LOG.warn("Failed to open file from webview:", filePath, err);
  }
}

async function handleLiveRunWebviewMessage(
  webview: vscode.Webview,
  msg: unknown
): Promise<void> {
  if (!isLivePanelFromWebviewMessage(msg)) {
    return;
  }

  if (msg.type === "livePanelReady") {
    void webview.postMessage({
      type: "protocol",
      version: LIVE_PANEL_PROTOCOL_VERSION
    });
    void postDiscoveryDataToWebview(webview);
    postResultsDataToWebview(webview);
    void webview.postMessage({
      type: "runStatus",
      isRunning: isBehaveRunActive()
    });
    postStoredLivePanelReplay(webview);
    return;
  }

  if (msg.type === "getDiscoveryData") {
    await postDiscoveryDataToWebview(webview);
    return;
  }

  if (msg.type === "runTest") {
    await handleRunTestFromWebview(webview, msg);
    return;
  }

  if (msg.type === "stopRun" || msg.type === "stopTest") {
    logBehaveRunCancel(
      "Cucumber-Behave Stop requested from webview"
    );
    cancelActiveBehaveRun();
    void webview.postMessage({ type: "runCancelled" });
    void webview.postMessage({ type: "runStatus", isRunning: false });
    return;
  }

  if (msg.type === "rerunLastRun") {
    void webview.postMessage({
      type: "switchToTab",
      tab: "execution"
    });
    await vscode.commands.executeCommand("behaveRunner.rerunLastRun");
    return;
  }

  if (msg.type === "openFile") {
    await handleOpenFileFromWebview(msg.filePath, msg.line);
    return;
  }

  if (msg.type === "getResultsData") {
    postResultsDataToWebview(webview);
    return;
  }

  if (msg.type === "clearResults") {
    behaveResultsManager.clearRecords();
    postResultsDataToWebview(webview);
    return;
  }

  if (msg.type === "generateAllure") {
    const res = await behaveResultsManager.generateAllureReport();
    void webview.postMessage({
      type: "allureGenerated",
      success: res.success,
      message: res.message,
      reportPath: res.reportPath,
      usedCli: res.usedCli
    });
    postResultsDataToWebview(webview);
    if (res.success) {
      void vscode.window.showInformationMessage(res.message, "View Allure Report").then((ans) => {
        if (ans === "View Allure Report") {
          void behaveResultsManager.viewAllureReport();
        }
      });
    } else {
      void vscode.window.showErrorMessage(res.message);
    }
    return;
  }

  if (msg.type === "viewAllure") {
    await behaveResultsManager.viewAllureReport();
    return;
  }

  if (msg.type === "setDefaultCaps") {
    if (msg.capsFile) {
      void vscode.workspace
        .getConfiguration("behave")
        .update("defaultConfigFile", msg.capsFile, vscode.ConfigurationTarget.Workspace);
      void vscode.window.showInformationMessage(
        `Default capability config set to: ${msg.capsFile}`
      );
    }
    return;
  }

  if (msg.type === "revealStep") {
    const fsPath =
      typeof msg.path === "string"
        ? msg.path
        : typeof msg.gotoPath === "string"
          ? msg.gotoPath
          : "";
    let lineRaw = NaN;
    if (typeof msg.line === "number" && Number.isFinite(msg.line)) {
      lineRaw = Math.floor(msg.line);
    } else if (typeof msg.gotoLine === "number" && Number.isFinite(msg.gotoLine)) {
      lineRaw = Math.floor(msg.gotoLine);
    } else if (typeof msg.line === "string") {
      const n = Number.parseInt(msg.line, 10);
      lineRaw = Number.isNaN(n) ? NaN : n;
    } else if (typeof msg.gotoLine === "string") {
      const n = Number.parseInt(msg.gotoLine, 10);
      lineRaw = Number.isNaN(n) ? NaN : n;
    }
    if (!fsPath || Number.isNaN(lineRaw)) {
      return;
    }
    await handleOpenFileFromWebview(fsPath, lineRaw);
  }
}
