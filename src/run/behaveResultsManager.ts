import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "../log";

export interface CompletedStepRecord {
  keyword: string;
  text: string;
  status: "passed" | "failed" | "skipped" | "undefined";
  error?: string;
  durationMs?: number;
}

export interface CompletedTestRecord {
  id: string;
  featureName: string;
  featureFilePath: string;
  relativeFilePath: string;
  scenarioName: string;
  scenarioLine: number;
  status: "passed" | "failed" | "skipped" | "cancelled";
  durationMs: number;
  timestamp: number;
  dateFormatted: string;
  capsFile?: string;
  errorMessage?: string;
  errorStep?: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  steps: CompletedStepRecord[];
}

export interface ResultsSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  lastRunTimestamp?: number;
}

const RESULTS_STORAGE_KEY = "cucumberBehave.completedResults.v2";
const MAX_STORED_RECORDS = 200;

class BehaveResultsManager {
  private workspaceState?: vscode.Memento;
  private records: CompletedTestRecord[] = [];
  private readonly changeListeners = new Set<() => void>();

  public initialize(context: vscode.ExtensionContext): void {
    this.workspaceState = context.workspaceState;
    const saved = this.workspaceState.get<CompletedTestRecord[]>(RESULTS_STORAGE_KEY);
    if (Array.isArray(saved)) {
      this.records = saved;
    }
  }

  public onDidChange(listener: () => void): vscode.Disposable {
    this.changeListeners.add(listener);
    return new vscode.Disposable(() => this.changeListeners.delete(listener));
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        LOG.warn("Error in results change listener:", err);
      }
    }
  }

  public recordScenario(data: Omit<CompletedTestRecord, "id" | "dateFormatted">): CompletedTestRecord {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const date = new Date(data.timestamp || Date.now());
    const dateFormatted = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const record: CompletedTestRecord = {
      ...data,
      id,
      dateFormatted
    };

    // Prepend new record (most recent first)
    this.records.unshift(record);
    if (this.records.length > MAX_STORED_RECORDS) {
      this.records = this.records.slice(0, MAX_STORED_RECORDS);
    }

    void this.persist();
    this.notifyChange();
    return record;
  }

  public getRecords(
    sort: "date_desc" | "date_asc" | "feature" | "scenario" = "date_desc",
    filterStatus?: string
  ): CompletedTestRecord[] {
    let result = [...this.records];
    if (filterStatus && filterStatus !== "all") {
      result = result.filter((r) => r.status === filterStatus);
    }

    switch (sort) {
      case "date_desc":
        result.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case "date_asc":
        result.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case "feature":
        result.sort((a, b) => a.featureName.localeCompare(b.featureName) || b.timestamp - a.timestamp);
        break;
      case "scenario":
        result.sort((a, b) => a.scenarioName.localeCompare(b.scenarioName) || b.timestamp - a.timestamp);
        break;
    }

    return result;
  }

  public getSummary(): ResultsSummary {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;

    for (const r of this.records) {
      if (r.status === "passed") passed++;
      else if (r.status === "failed") failed++;
      else if (r.status === "skipped") skipped++;
      else if (r.status === "cancelled") cancelled++;
    }

    return {
      total: this.records.length,
      passed,
      failed,
      skipped,
      cancelled,
      lastRunTimestamp: this.records[0]?.timestamp
    };
  }

  public clearRecords(): void {
    this.records = [];
    void this.persist();
    this.notifyChange();
  }

  private async persist(): Promise<void> {
    if (this.workspaceState) {
      try {
        await this.workspaceState.update(RESULTS_STORAGE_KEY, this.records);
      } catch (err) {
        LOG.warn("Failed to persist test results:", err);
      }
    }
  }

  /**
   * Generates an Allure Report using the latest Allure CLI (allure-commandline).
   * If `allure` CLI is not found in PATH, returns success: false with an error message detailing
   * the installation instructions (e.g. npm install -g allure-commandline@latest or scoop install allure).
   */
  public async generateAllureReport(
    workspaceRoot?: string
  ): Promise<{ success: boolean; reportPath: string; message: string; usedCli: boolean; missingCli?: boolean }> {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const reportsDir = path.join(root, "reports", "allure-report");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportIndexPath = path.join(reportsDir, "index.html");

    // 1. Check if allure CLI is available in PATH
    let hasAllureCli = false;
    let allureVersion = "";
    try {
      const verBuf = cp.execSync("allure --version", { stdio: "pipe" });
      allureVersion = verBuf.toString().trim();
      hasAllureCli = true;
    } catch {
      hasAllureCli = false;
    }

    if (!hasAllureCli) {
      // Generate standalone preview so test data is captured
      const htmlContent = this.generateStandaloneAllureHtml(this.records, root);
      fs.writeFileSync(reportIndexPath, htmlContent, "utf-8");

      const errorMsg =
        "Allure CLI was not found in PATH. Please install the latest Allure CLI: 'npm install -g allure-commandline@latest' (or 'scoop install allure') and ensure 'allure' is accessible in PATH. A standalone HTML preview report was generated at reports/allure-report/index.html.";
      return {
        success: false,
        reportPath: reportIndexPath,
        message: errorMsg,
        usedCli: false,
        missingCli: true
      };
    }

    // 2. Look for allure-results directory produced by allure-behave
    const candidateResultsDirs = [
      path.join(root, "allure-results"),
      path.join(root, "reports", "allure-results"),
      path.join(root, "target", "allure-results")
    ];
    let foundResultsDir: string | undefined;
    for (const dir of candidateResultsDirs) {
      if (fs.existsSync(dir)) {
        foundResultsDir = dir;
        break;
      }
    }

    let usedCli = false;
    if (foundResultsDir) {
      try {
        cp.execSync(`allure generate "${foundResultsDir}" -o "${reportsDir}" --clean`, {
          cwd: root,
          stdio: "pipe"
        });
        usedCli = true;
      } catch (err) {
        LOG.warn("Allure CLI generation failed, falling back to standalone generator:", err);
      }
    }

    // 3. If Allure CLI was not used or failed (e.g. no allure-results yet), generate the standalone Allure-style HTML report
    if (!usedCli || !fs.existsSync(reportIndexPath)) {
      const htmlContent = this.generateStandaloneAllureHtml(this.records, root);
      fs.writeFileSync(reportIndexPath, htmlContent, "utf-8");
    }

    const msg = usedCli
      ? `Allure Report generated successfully via Allure CLI ${allureVersion ? `(v${allureVersion})` : ""} in ${reportsDir}`
      : `Generated Allure-style HTML Report in ${reportsDir}. (Tip: Run Behave with '-f allure_behave.formatter:AllureFormatter -o allure-results' to produce native Allure data for Allure CLI v${allureVersion || "latest"}).`;

    return {
      success: true,
      reportPath: reportIndexPath,
      message: msg,
      usedCli
    };
  }

  /**
   * Opens the generated Allure Report in browser.
   */
  public async viewAllureReport(workspaceRoot?: string): Promise<void> {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const reportsDir = path.join(root, "reports", "allure-report");
    const reportIndexPath = path.join(reportsDir, "index.html");

    if (!fs.existsSync(reportIndexPath)) {
      const genResult = await this.generateAllureReport(root);
      if (!genResult.success) {
        void vscode.window.showErrorMessage("Failed to generate Allure Report.");
        return;
      }
    }

    try {
      const uri = vscode.Uri.file(reportIndexPath);
      await vscode.env.openExternal(uri);
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open Allure Report: ${err}`);
    }
  }

  /**
   * Generates a modern, standalone Allure-style interactive HTML report.
   */
  private generateStandaloneAllureHtml(records: CompletedTestRecord[], workspaceRoot: string): string {
    const summary = this.getSummary();
    const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
    const nowStr = new Date().toLocaleString();

    // Group by feature
    const featuresMap = new Map<string, CompletedTestRecord[]>();
    for (const r of records) {
      const list = featuresMap.get(r.featureName) || [];
      list.push(r);
      featuresMap.set(r.featureName, list);
    }

    const featureRowsHtml = Array.from(featuresMap.entries())
      .map(([featureName, scList]) => {
        const featPassed = scList.filter((s) => s.status === "passed").length;
        const featFailed = scList.filter((s) => s.status === "failed").length;
        const featStatus = featFailed > 0 ? "failed" : "passed";

        const scenariosHtml = scList
          .map((sc) => {
            const scStatusClass = sc.status;
            const stepsHtml = (sc.steps || [])
              .map(
                (st) => `
              <li class="step-item step-${st.status}">
                <span class="step-keyword">${this.escapeHtml(st.keyword)}</span>
                <span class="step-text">${this.escapeHtml(st.text)}</span>
                <span class="step-status-badge badge-${st.status}">${st.status}</span>
                ${st.error ? `<pre class="step-error">${this.escapeHtml(st.error)}</pre>` : ""}
              </li>`
              )
              .join("");

            return `
            <div class="scenario-card status-${scStatusClass}">
              <div class="scenario-header" onclick="this.parentElement.classList.toggle('open')">
                <div class="scenario-title">
                  <span class="status-indicator indicator-${scStatusClass}"></span>
                  <span class="scenario-name">${this.escapeHtml(sc.scenarioName)}</span>
                  <span class="scenario-time">${sc.dateFormatted} (${(sc.durationMs / 1000).toFixed(2)}s)</span>
                </div>
                <div class="scenario-meta">
                  ${sc.capsFile ? `<span class="meta-caps">⚙ ${this.escapeHtml(sc.capsFile)}</span>` : ""}
                  <span class="meta-steps">${sc.passedSteps}/${sc.totalSteps} steps</span>
                  <span class="expand-arrow">▼</span>
                </div>
              </div>
              <div class="scenario-body">
                ${sc.errorMessage ? `<div class="failure-box"><strong>Error:</strong> ${this.escapeHtml(sc.errorMessage)}</div>` : ""}
                <ul class="steps-list">
                  ${stepsHtml || "<li class='no-steps'>No recorded step details</li>"}
                </ul>
              </div>
            </div>`;
          })
          .join("");

        return `
        <div class="feature-suite feature-${featStatus}">
          <div class="feature-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <div class="feature-title-group">
              <span class="suite-status-pill pill-${featStatus}">${featStatus.toUpperCase()}</span>
              <h3 class="feature-name">${this.escapeHtml(featureName)}</h3>
            </div>
            <div class="feature-counts">
              <span class="count-passed">${featPassed} Passed</span>
              ${featFailed > 0 ? `<span class="count-failed">${featFailed} Failed</span>` : ""}
              <span class="count-total">${scList.length} Scenarios</span>
              <span class="suite-arrow">▼</span>
            </div>
          </div>
          <div class="feature-scenarios">
            ${scenariosHtml}
          </div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cucumber-Behave Allure Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #ffffff;
      --text-muted: #8b949e;
      --pass: #238636;
      --pass-light: #2ea043;
      --fail: #da3633;
      --fail-light: #f85149;
      --accent: #58a6ff;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .logo-title { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      background: linear-gradient(135deg, #238636, #1f6feb);
      color: white;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 16px;
    }
    h1 { font-size: 24px; color: var(--text-bright); }
    .header-meta { font-size: 13px; color: var(--text-muted); text-align: right; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
    }
    .summary-card .label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .summary-card .value { font-size: 28px; font-weight: 700; color: var(--text-bright); margin-top: 6px; }
    .summary-card.pass .value { color: var(--pass-light); }
    .summary-card.fail .value { color: var(--fail-light); }
    .summary-card.rate .value { color: var(--accent); }
    .progress-bar-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .progress-bar {
      height: 12px;
      background: #21262d;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      margin-top: 8px;
    }
    .progress-pass { background: var(--pass-light); height: 100%; }
    .progress-fail { background: var(--fail-light); height: 100%; }
    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search-input {
      flex: 1;
      min-width: 240px;
      background: #21262d;
      border: 1px solid var(--border);
      color: var(--text-bright);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }
    .filter-btn {
      background: #21262d;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .filter-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .feature-suite {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .feature-header {
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      background: #1c2128;
    }
    .feature-title-group { display: flex; align-items: center; gap: 12px; }
    .suite-status-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
    }
    .pill-passed { background: rgba(46, 160, 67, 0.2); color: var(--pass-light); }
    .pill-failed { background: rgba(248, 81, 73, 0.2); color: var(--fail-light); }
    .feature-name { font-size: 15px; color: var(--text-bright); }
    .feature-counts { display: flex; align-items: center; gap: 14px; font-size: 13px; color: var(--text-muted); }
    .count-passed { color: var(--pass-light); font-weight: 600; }
    .count-failed { color: var(--fail-light); font-weight: 600; }
    .suite-arrow { transition: transform 0.2s; font-size: 12px; }
    .feature-suite.collapsed .suite-arrow { transform: rotate(-90deg); }
    .feature-suite.collapsed .feature-scenarios { display: none; }
    .feature-scenarios { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .scenario-card {
      border: 1px solid #21262d;
      border-radius: 6px;
      background: #0d1117;
      overflow: hidden;
    }
    .scenario-header {
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .scenario-title { display: flex; align-items: center; gap: 10px; }
    .status-indicator { width: 10px; height: 10px; border-radius: 50%; }
    .indicator-passed { background: var(--pass-light); }
    .indicator-failed { background: var(--fail-light); }
    .scenario-name { font-size: 13px; font-weight: 600; color: var(--text-bright); }
    .scenario-time { font-size: 12px; color: var(--text-muted); }
    .scenario-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); }
    .meta-caps { background: #21262d; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .expand-arrow { transition: transform 0.2s; font-size: 10px; }
    .scenario-card.open .expand-arrow { transform: rotate(180deg); }
    .scenario-body { display: none; padding: 12px 16px 14px 34px; border-top: 1px solid #21262d; }
    .scenario-card.open .scenario-body { display: block; }
    .failure-box {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      color: #ff7b72;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 12px;
      font-family: monospace;
      white-space: pre-wrap;
    }
    .steps-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .step-item { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
    .step-keyword { font-weight: 700; color: #79c0ff; min-width: 50px; }
    .step-text { color: var(--text); flex: 1; }
    .step-status-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .badge-passed { background: rgba(46, 160, 67, 0.2); color: var(--pass-light); }
    .badge-failed { background: rgba(248, 81, 73, 0.2); color: var(--fail-light); }
    .badge-skipped { background: rgba(139, 148, 158, 0.2); color: var(--text-muted); }
    .step-error { width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 8px 12px; margin-top: 4px; color: #f85149; font-size: 12px; font-family: monospace; white-space: pre-wrap; }
    footer { margin-top: 40px; text-align: center; font-size: 12px; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-title">
        <div class="logo-badge">BDD</div>
        <div>
          <h1>Cucumber-Behave Test Execution & Allure Report</h1>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Workspace: ${this.escapeHtml(path.basename(workspaceRoot))}</div>
        </div>
      </div>
      <div class="header-meta">
        <div>Generated: ${nowStr}</div>
        <div>Engine: Smart Cucumber-Behave Runner</div>
      </div>
    </header>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Total Scenarios</div>
        <div class="value">${summary.total}</div>
      </div>
      <div class="summary-card pass">
        <div class="label">Passed</div>
        <div class="value">${summary.passed}</div>
      </div>
      <div class="summary-card fail">
        <div class="label">Failed</div>
        <div class="value">${summary.failed}</div>
      </div>
      <div class="summary-card rate">
        <div class="label">Success Rate</div>
        <div class="value">${passRate}%</div>
      </div>
    </div>

    <div class="progress-bar-container">
      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted);">
        <span>Execution Distribution</span>
        <span>${summary.passed} passed / ${summary.failed} failed</span>
      </div>
      <div class="progress-bar">
        <div class="progress-pass" style="width: ${passRate}%;"></div>
        <div class="progress-fail" style="width: ${100 - passRate}%;"></div>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="reportSearch" class="search-input" placeholder="Search features, scenarios, steps..." oninput="filterReport()">
      <button class="filter-btn active" onclick="setFilter('all', this)">All (${summary.total})</button>
      <button class="filter-btn" onclick="setFilter('passed', this)">Passed (${summary.passed})</button>
      <button class="filter-btn" onclick="setFilter('failed', this)">Failed (${summary.failed})</button>
    </div>

    <div id="suitesRoot">
      ${featureRowsHtml || '<div style="text-align:center; padding:40px; color:var(--text-muted);">No test execution records found. Run tests from VS Code to populate report.</div>'}
    </div>

    <footer>
      Smart Cucumber-Behave Test Runner & Allure Reporter • Generated automatically from execution runs
    </footer>
  </div>

  <script>
    let currentFilter = 'all';

    function setFilter(filter, btn) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterReport();
    }

    function filterReport() {
      const q = (document.getElementById('reportSearch').value || '').toLowerCase();
      document.querySelectorAll('.scenario-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        const matchesQuery = !q || text.includes(q);
        const matchesFilter = currentFilter === 'all' || card.classList.contains('status-' + currentFilter);
        card.style.display = (matchesQuery && matchesFilter) ? '' : 'none';
      });

      document.querySelectorAll('.feature-suite').forEach(suite => {
        const visibleScenarios = suite.querySelectorAll('.scenario-card:not([style*="display: none"])');
        suite.style.display = visibleScenarios.length > 0 ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

export const behaveResultsManager = new BehaveResultsManager();
