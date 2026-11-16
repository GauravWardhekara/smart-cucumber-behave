import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "../log";
import {
  generateStandaloneAllureHtml,
  highlightDomHtml
} from "./allureReportGenerator";

export interface CompletedStepRecord {
  keyword: string;
  text: string;
  status: "passed" | "failed" | "skipped" | "undefined";
  error?: string;
  durationMs?: number;
}

export interface TestArtifact {
  name: string;
  type: "screenshot" | "dom_dump" | "other";
  filePath: string;
  relativePath?: string;
  fileSize?: number;
  dataUri?: string;
  snippet?: string;
  content?: string;
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
  artifacts?: TestArtifact[];
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
  private readonly claimedArtifactPaths = new Set<string>();

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

  /**
   * Scans candidate directories to discover screenshots and DOM dumps created on test failure.
   * Scoped strictly to the specific test execution instance so artifacts from other tests are not leaked.
   */
  public findFailureArtifacts(
    scenario: {
      scenarioName: string;
      featureName?: string;
      timestamp?: number;
      durationMs?: number;
      featureFilePath?: string;
    },
    workspaceRoot?: string
  ): TestArtifact[] {
    const root =
      workspaceRoot ||
      (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

    // Candidate directories where screenshots and dom dumps may be saved
    const candidateDirs = [
      path.join(root, "reports", "screenshots"),
      path.join(root, "screenshots"),
      path.join(root, "reports", "dom_dumps"),
      path.join(root, "reports", "dom"),
      path.join(root, "reports", "page_source"),
      path.join(root, "dom_dumps"),
      path.join(root, "dom"),
      path.join(root, "page_source"),
      path.join(root, "reports"),
      path.join(root, "allure-results")
    ];

    if (scenario.featureFilePath) {
      candidateDirs.push(path.dirname(scenario.featureFilePath));
    }

    const seenPaths = new Set<string>();

    // Exact execution window for this specific test execution instance
    const endTime = scenario.timestamp || Date.now();
    const duration = scenario.durationMs && scenario.durationMs > 0 ? scenario.durationMs : 3000;
    const startTime = endTime - duration;
    // 2s lead before start and 8s teardown buffer after scenario end
    const instanceWindowStart = startTime - 2000;
    const instanceWindowEnd = endTime + 8000;

    const scNameLower = scenario.scenarioName.toLowerCase();
    const scSlug = scenario.scenarioName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const scCompact = scNameLower.replace(/[^a-z0-9]/g, "");

    // Identify slugs and compact names belonging to OTHER scenarios in this run
    // to strictly prevent cross-scenario artifact association
    const otherScenarioIdentifiers = new Set<string>();
    for (const r of this.records) {
      if (r.scenarioName && r.scenarioName.toLowerCase() !== scNameLower) {
        const otherSlug = r.scenarioName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        const otherCompact = r.scenarioName.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (otherSlug.length >= 4) otherScenarioIdentifiers.add(otherSlug);
        if (otherCompact.length >= 4) otherScenarioIdentifiers.add(otherCompact);
      }
    }

    interface CandidateMatch {
      artifact: TestArtifact;
      score: number;
    }

    const screenshotCandidates: CandidateMatch[] = [];
    const domCandidates: CandidateMatch[] = [];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const fullPath = path.join(dir, entry.name);
          const resolvedPath = path.resolve(fullPath);

          if (seenPaths.has(resolvedPath)) continue;
          // Skip if artifact was already claimed by another test execution instance
          if (this.claimedArtifactPaths.has(resolvedPath)) continue;

          const ext = path.extname(entry.name).toLowerCase();
          const nameLower = entry.name.toLowerCase();
          const fileCompact = nameLower.replace(/[^a-z0-9]/g, "");

          // Determine artifact type
          let type: "screenshot" | "dom_dump" | undefined;
          if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"].includes(ext)) {
            type = "screenshot";
          } else if (
            [".html", ".xml", ".dom", ".htm", ".txt", ".json"].includes(ext) &&
            (nameLower.includes("dom") ||
              nameLower.includes("dump") ||
              nameLower.includes("page_source") ||
              nameLower.includes("source") ||
              nameLower.includes("attachment") ||
              dir.toLowerCase().includes("dom") ||
              dir.toLowerCase().includes("page_source"))
          ) {
            type = "dom_dump";
          }

          if (!type) continue;

          let stats: fs.Stats | undefined;
          try {
            stats = fs.statSync(fullPath);
          } catch {
            continue;
          }

          const mtime = stats.mtimeMs;

          // Check if file clearly belongs to another scenario in the test run
          let belongsToOtherScenario = false;
          for (const otherId of otherScenarioIdentifiers) {
            if (nameLower.includes(otherId) || fileCompact.includes(otherId)) {
              belongsToOtherScenario = true;
              break;
            }
          }
          if (belongsToOtherScenario) {
            continue;
          }

          // Check matching for this specific test execution instance
          const isDirectNameMatch =
            nameLower.includes(scSlug) ||
            nameLower.includes(scNameLower) ||
            (scCompact.length >= 4 && fileCompact.includes(scCompact));

          const isWithinInstanceWindow =
            mtime >= instanceWindowStart && mtime <= instanceWindowEnd;

          let score = 0;
          if (isDirectNameMatch) {
            // Strong name match: check recency to prevent attaching files from days ago
            const timeDelta = Math.abs(mtime - endTime);
            if (timeDelta <= 1_800_000) { // within 30 minutes
              score = 1000 - Math.min(400, Math.round(timeDelta / 1000));
            }
          } else if (isWithinInstanceWindow) {
            // Generic/unnamed file generated strictly during this test execution instance
            const timeDelta = Math.abs(mtime - endTime);
            score = 500 - Math.min(300, Math.round(timeDelta / 1000));
          }

          if (score <= 0) continue;

          seenPaths.add(resolvedPath);
          const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

          let dataUri: string | undefined;
          if (type === "screenshot" && stats.size <= 2_000_000) {
            try {
              const buf = fs.readFileSync(fullPath);
              const mime =
                ext === ".png"
                  ? "image/png"
                  : ext === ".jpg" || ext === ".jpeg"
                    ? "image/jpeg"
                    : "image/png";
              dataUri = `data:${mime};base64,${buf.toString("base64")}`;
            } catch {
              /* ignore */
            }
          }

          let snippet: string | undefined;
          if (type === "dom_dump") {
            try {
              const raw = fs.readFileSync(fullPath, "utf-8");
              snippet = raw.slice(0, 1000);
            } catch {
              /* ignore */
            }
          }

          const artifact: TestArtifact = {
            name: entry.name,
            type,
            filePath: fullPath,
            relativePath: relPath,
            fileSize: stats.size,
            dataUri,
            snippet
          };

          if (type === "screenshot") {
            screenshotCandidates.push({ artifact, score });
          } else if (type === "dom_dump") {
            domCandidates.push({ artifact, score });
          }
        }
      } catch {
        /* ignore folder read errors */
      }
    }

    // Pick top matching screenshot and top matching DOM dump for this execution instance
    const selected: TestArtifact[] = [];

    if (screenshotCandidates.length > 0) {
      screenshotCandidates.sort((a, b) => b.score - a.score);
      const topShot = screenshotCandidates[0].artifact;
      selected.push(topShot);
      this.claimedArtifactPaths.add(path.resolve(topShot.filePath));
    }

    if (domCandidates.length > 0) {
      domCandidates.sort((a, b) => b.score - a.score);
      const topDom = domCandidates[0].artifact;
      selected.push(topDom);
      this.claimedArtifactPaths.add(path.resolve(topDom.filePath));
    }

    return selected;
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

    let artifacts = data.artifacts;
    if ((!artifacts || artifacts.length === 0) && data.status === "failed") {
      const found = this.findFailureArtifacts(data);
      if (found.length > 0) {
        artifacts = found;
      }
    } else if (artifacts && artifacts.length > 0) {
      for (const a of artifacts) {
        if (a.filePath) {
          this.claimedArtifactPaths.add(path.resolve(a.filePath));
        }
      }
    }

    const record: CompletedTestRecord = {
      ...data,
      id,
      dateFormatted,
      artifacts
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
    this.claimedArtifactPaths.clear();
    void this.persist();
    this.notifyChange();
  }

  private async persist(): Promise<void> {
    if (this.workspaceState) {
      try {
        // Strip heavy dataUri and content to avoid sqlite storage bloat
        const lightweight = this.records.map((r) => ({
          ...r,
          artifacts: r.artifacts?.map(({ dataUri, content, ...rest }) => rest)
        }));
        await this.workspaceState.update(RESULTS_STORAGE_KEY, lightweight);
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

    // 0. Ensure already populated scenario artifacts are claimed
    for (const r of this.records) {
      if (r.artifacts) {
        for (const a of r.artifacts) {
          if (a.filePath) {
            this.claimedArtifactPaths.add(path.resolve(a.filePath));
          }
        }
      }
    }

    // Discover and link failure artifacts for failed scenarios that do not yet have artifacts
    for (const r of this.records) {
      if (r.status === "failed" && (!r.artifacts || r.artifacts.length === 0)) {
        const found = this.findFailureArtifacts(r, root);
        if (found.length > 0) {
          r.artifacts = found;
        }
      }
    }

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
      const htmlContent = generateStandaloneAllureHtml(this.records, this.getSummary(), root);
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
      const htmlContent = generateStandaloneAllureHtml(this.records, this.getSummary(), root);
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

  public highlightDomHtml(raw: string): string {
    return highlightDomHtml(raw);
  }

  public generateStandaloneAllureHtml(records: CompletedTestRecord[], workspaceRoot: string): string {
    return generateStandaloneAllureHtml(records, this.getSummary(), workspaceRoot);
  }
}

export const behaveResultsManager = new BehaveResultsManager();
