# Smart Cucumber-Behave

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Smart%20Cucumber--Behave-blue.svg)](https://marketplace.visualstudio.com)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Smart%20Cucumber--Behave-purple.svg)](https://open-vsx.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cucumber](https://img.shields.io/badge/Cucumber-Language%20Server-green.svg)](https://cucumber.io/)
[![Python: Behave](https://img.shields.io/badge/Python-Behave%20BDD-brightgreen.svg)](https://behave.readthedocs.io/)

A complete, high-performance Visual Studio Code extension integrating the **official [Cucumber Language Server](https://github.com/cucumber/vscode)** with the advanced **Smart Behave Runner** test execution engine.

---

## 🌟 What is Smart Cucumber-Behave?

**Smart Cucumber-Behave** combines two complete BDD toolsets into a single extension:

1. **Official Cucumber Language Server (`@cucumber/language-server`)**:
   - Backed by tree-sitter WebAssembly (WASM) grammars.
   - Cross-language step definition indexing (`cucumber.glue`) supporting **Python**, **TypeScript/JavaScript**, **Java**, **C#**, **Ruby**, **PHP**, **Rust**, and **Go**.
   - Full support for **Cucumber Expressions** and Regular Expressions.
   - Support for **Custom Parameter Types** (`cucumber.parameterTypes`).
   - Autocomplete for Given/When/Then steps across all glue languages.
   - Go to Step Definition (F12) across all glue languages.
   - Diagnostics for undefined steps and Gherkin syntax errors.
   - Quick Fix action to generate step definition snippets.
   - Document structure, semantic tokens, and formatting.

2. **Smart Behave Test Runner & Execution Platform**:
   - **Native VS Code Test Explorer (`TestController`)**: Instant zero-latency discovery of Features, Scenarios, and Examples with pass/fail hierarchy propagation (when a scenario fails, the scenario and whole feature are marked failed; when all pass, both pass).
   - **Live Run Webview Panel**: Dedicated real-time dashboard with streaming logs, status indicators, elapsed timers, a **Cancel Run** button (with warning/confirmation modal to terminate lingering processes), and a **Rerun Last Run** button.
   - **Interactive Configuration Screen**: Easily probe active Python runtime, validate Behave CLI capabilities, manage test arguments, inspect step indexes, and switch test capabilities/config files.
   - **In-Editor CodeLens**: `▶ Run` and `🐞 Debug` buttons directly above Features, Scenarios, and Example rows.
   - **Full Debugging (`debugpy`)**: Breakpoint debugging inside step functions, hooks, and environment fixtures with `justMyCode` stepping.

---

## 🚀 Key Features

### 🥒 Official Cucumber Language Server Integration
- **Multilingual Step Definitions**: Index step implementations in Python (`*.py`), JavaScript/TypeScript (`*.js`, `*.ts`, `*.jsx`, `*.tsx`), Java (`*.java`), C# (`*.cs`), Ruby (`*.rb`), PHP (`*.php`), Rust (`*.rs`), and Go (`*_test.go`).
- **Cucumber Expressions**: Native matching for `{int}`, `{float}`, `{word}`, `{string}`, `{anonymous}`, and custom types.
- **Custom Parameter Types**: Configure your own types via `cucumber.parameterTypes`.
- **Cross-language Autocomplete & Navigation**: Jump between `.feature` files and your code effortlessly.

### 🧪 Native VS Code Test Explorer (`vscode.TestController`)
- **Instant Discovery**: Fast pure-TypeScript AST parsing discovers features, scenarios, scenario outlines, and example tables instantly.
- **Pass/Fail Propagation**:
  - If any scenario fails, both the scenario and the parent Feature are marked as failed.
  - If all scenarios pass, both the scenarios and the parent Feature are marked as passed.
- **Side-by-Side Diffs**: Failed assertions matching `smartBehave.diffRegex` display expected vs. actual side-by-side in VS Code's native diff viewer.

### ⚡ Live Run Dashboard & Process Control
- Real-time streaming logs from `behave`.
- **Stop Button**: Cancel executing test suites with a warning/confirmation prompt that safely kills child Python/behave processes.
- **Rerun Button**: Quickly rerun the exact same test selection with a single click.

### ⚙️ Interactive Configuration & Capabilities Selector
- Open anytime via **`Smart Behave: Open Configuration Screen`** (`smartBehave.openConfiguration`).
- Detects configurations and capabilities files in `configs/` (e.g. `android_caps_v1.json`, `ios_caps_v5.json`).
- Injects `-D caps_file=...` automatically without manual command-line editing.

---

## 🛠️ Configuration Settings

### Cucumber Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cucumber.features` | `string[]` | `["src/test/**/*.feature", "features/**/*.feature", "tests/**/*.feature", "*specs*/**/*.feature"]` | Glob patterns for Gherkin `.feature` files. |
| `cucumber.glue` | `string[]` | `["*specs*/**/*.cs", "features/**/*.js", "features/**/*.jsx", "features/**/*.php", "features/**/*.py", "features/**/*.rs", "features/**/*.rb", "features/**/*.ts", "features/**/*.tsx", "features/**/*_test.go", "src/test/**/*.java", "tests/**/*.py", "tests/**/*.rs"]` | Glob patterns for source code where step definitions and parameter types are defined. |
| `cucumber.parameterTypes` | `array` | `[]` | Custom Cucumber Parameter Types definitions. |

### Behave Runner Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `smartBehave.featureFiles.patterns` | `string[]` | `["**/*.feature"]` | Glob patterns for Behave feature files. |
| `smartBehave.stepDefinitions.patterns` | `string[]` | `["**/steps/**/*.py", "**/*_steps.py", "**/step_*.py", "**/steps.py"]` | Glob patterns for Python step definition files. |
| `smartBehave.autoDiscover` | `boolean` | `true` | Automatically discover and index all tests on startup. |
| `smartBehave.codeLens` | `boolean` | `false` | Enable or disable in-editor CodeLens (Run/Debug buttons). |
| `smartBehave.arguments` | `string[]` | `["-f", "pretty"]` | Additional CLI arguments to pass to `behave`. |
| `smartBehave.extraArgs` | `string[]` | `[]` | Extra arguments passed to behave on every run and debug launch. |
| `smartBehave.configDirectory` | `string` | `"configs"` | Directory where capability and properties files are stored. |
| `smartBehave.diffRegex` | `string[]` | `["Expected: (?<expected>.*)[\\s\\S]*but: was (?<actual>.*)"]` | Regex patterns to extract expected vs. actual values for failure diffs. |

---

## ⌨️ Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `smartBehave.openConfiguration` | `Smart Behave: Open Configuration Screen` | Open the interactive configuration webview. |
| `smartBehave.selectConfigFile` | `Smart Behave: Select Configuration / Capabilities File` | QuickPick to switch active caps/config file. |
| `smartBehave.run` | `Smart Behave: Run` | Run the selected feature or scenario. |
| `smartBehave.debug` | `Smart Behave: Debug` | Debug the selected feature or scenario with `debugpy`. |
| `smartBehave.cancelRun` | `Smart Behave: Cancel Run` | Terminate running test process with confirmation. |
| `smartBehave.rerunLastRun` | `Smart Behave: Rerun Last Run` | Rerun the last executed test session. |
| `smartBehave.showLiveRun` | `Smart Behave: Show Live Run Panel` | Focus the Live Run execution dashboard. |
| `smartBehave.generateStepDefinition` | `Smart Behave: Generate Step Definition in Python` | Generate Python step definition code snippet. |

---

## 📦 Multi-Registry Packaging

This extension is configured for independent publication to both registries:
- **VS Code Marketplace**: Publisher `GauravWardhekar`
- **Open VSX Registry**: Publisher `GauravWardhekara`

```bash
# Package for all registries:
npm run package:all

# Package specifically for VS Code Marketplace:
npm run package:vscode

# Package specifically for Open VSX Registry:
npm run package:openvsx
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
