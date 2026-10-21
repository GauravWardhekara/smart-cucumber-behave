# Smart Cucumber-Behave

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Smart%20Cucumber--Behave-blue.svg)](https://marketplace.visualstudio.com)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Smart%20Cucumber--Behave-purple.svg)](https://open-vsx.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cucumber](https://img.shields.io/badge/Cucumber-Language%20Server-green.svg)](https://cucumber.io/)
[![Python: Behave](https://img.shields.io/badge/Python-Behave%20BDD-brightgreen.svg)](https://behave.readthedocs.io/)

A complete, high-performance Visual Studio Code extension integrating the **official [Cucumber Language Server](https://github.com/cucumber/vscode)** with the advanced **Smart Behave Runner** test execution engine and fine-grained **Custom Gherkin Formatter**.

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
   - Document structure and semantic tokens.

2. **Smart Behave Test Runner & Execution Platform**:
   - **Native VS Code Test Explorer (`TestController`)**: Instant zero-latency discovery of Features, Scenarios, and Examples with pass/fail hierarchy propagation (when a scenario fails, the scenario and whole feature are marked failed; when all pass, both pass).
   - **Cucumber-Behave Live Run Panel**: Dedicated bottom panel tab (**`Cucumber-Behave` &rarr; `Live Run`**) with streaming logs, status indicators, elapsed timers, a **Cancel Run** button (with warning/confirmation modal to terminate lingering processes), and a **Rerun Last Run** button.
   - **Multi-Language Interactive Configuration Screen**: Multi-runtime diagnostic prober (Python, Node.js, Java, .NET, Ruby, PHP, Rust, Go), live Gherkin formatter preview, Cucumber settings, and Behave test runner settings.
   - **In-Editor CodeLens**: `▶ Run` and `🐞 Debug` buttons directly above Features, Scenarios, and Example rows.
   - **Full Debugging (`debugpy`)**: Breakpoint debugging inside step functions, hooks, and environment fixtures with `justMyCode` stepping.

3. **Custom Gherkin Keyword Formatter**:
   - Fully customizable, keyword-specific indentation levels for **Feature, Scenario, Background, Given, When, Then, And, But**.
   - Default **Stepped Ladder** preset: Feature has 0 tabs, Scenario has 1 tab, Given has 2 tabs, When has 2 tabs, Then has 3 tabs, And has 4 tabs, But has 4 tabs.
   - Formats via standard VS Code document formatting (`Shift+Alt+F`), format-on-save, and on-type table pipe formatting (`|`).

---

## 🚀 Key Features

### 📐 Custom Gherkin Formatter
Customize exact indentation levels (tabs or spaces) per Gherkin keyword:

| Keyword | Default Tabs | Description |
| :--- | :---: | :--- |
| **`Feature:`** | `0` | Root feature header has no tab |
| **`Scenario:`** / **`Scenario Outline:`** | `1` | One tab after Feature |
| **`Background:`** | `1` | Feature background setup block |
| **`Rule:`** | `1` | Business rule header |
| **`Given`** | `2` | Initial context step (one more tab after Scenario) |
| **`When`** | `2` | Action step |
| **`Then`** | `3` | Outcome step (one more tab after Given) |
| **`And`** | `4` | Subsequent step (one more tab after Then) |
| **`But`** | `4` | Negative assertion step |
| **`Examples:`** | `2` | Scenario Outline examples header |
| **Tables (`\| cell \|`)** | Auto | Neatly padded and aligned pipes under parent step/examples |
| **Docstrings (`"""`)** | Auto | Aligned under parent step with automated JSON formatting |

```gherkin
Feature: User Authentication & Dashboard
	Background: Database initialization
		Given database connection is open

	Scenario: Successful login with multi-factor authentication
		Given user is on login page
		When user enters valid credentials
			Then user receives one-time passcode
				And security dashboard is displayed
				But lockout warning is not triggered
```

* **Interactive Presets**: Switch instantly in the Configuration Screen between **Stepped Ladder (0, 1, 2, 2, 3, 4, 4)**, **Standard BDD (0, 1, 2, 2, 2, 2, 2)**, or **Strict Cascade**.
* **Indentation Character**: Choose `"tab"` (force `\t`), `"spaces"`, or `"auto"` (respecting editor tab settings).
* **Relative And/But**: Option to dynamically indent `And`/`But` +1 tab after the preceding step.

---

### 🌐 Multi-Language Interactive Configuration Screen
Open anytime via **`Smart Behave: Open Configuration Screen`** (`smartBehave.openConfiguration`):
- **Multi-Language Runtime Probe**: One-click probe detecting active versions for **Python**, **JavaScript/TypeScript (Node.js)**, **Java (JDK)**, **C# (.NET)**, **Ruby**, **PHP**, **Rust**, and **Go**.
- **Interactive Formatter Controls**: Slider/number inputs with an **instant live Gherkin preview box** updating in real-time as you tweak tab values.
- **Cucumber Global Settings**: Direct editing of `cucumber.features`, `cucumber.glue`, and `cucumber.parameterTypes`.
- **Python Behave Runner Settings**: Probes Behave CLI version, manages CLI arguments, config directory, and capability files (`caps_file`).
- **Dual Target Saving**: Save configuration changes directly to your **Workspace Settings** (`.vscode/settings.json`) or **User Settings** (`global`).

---

### 🥒 Official Cucumber Language Server Integration
- **Multilingual Step Definitions**: Index step implementations in Python (`*.py`), JavaScript/TypeScript (`*.js`, `*.ts`, `*.jsx`, `*.tsx`), Java (`*.java`), C# (`*.cs`), Ruby (`*.rb`), PHP (`*.php`), Rust (`*.rs`), and Go (`*_test.go`).
- **Cucumber Expressions**: Native matching for `{int}`, `{float}`, `{word}`, `{string}`, `{anonymous}`, and custom parameter types.
- **Cross-language Autocomplete & Navigation**: Jump between `.feature` files and glue source code with Go to Definition (F12).

---

### 🧪 Native VS Code Test Explorer (`vscode.TestController`)
- **Instant Discovery**: Fast pure-TypeScript AST parsing discovers features, scenarios, scenario outlines, and example tables instantly.
- **Pass/Fail Propagation**:
  - If any scenario fails, both the scenario and the parent Feature are marked as failed.
  - If all scenarios pass, both the scenarios and the parent Feature are marked as passed.
- **Side-by-Side Diffs**: Failed assertions matching `smartBehave.diffRegex` display expected vs. actual side-by-side in VS Code's native diff viewer.

---

### ⚡ Cucumber-Behave Live Run Panel
Located in the bottom panel under the **`Cucumber-Behave`** tab:
- Real-time streaming logs from test execution.
- **Stop Button**: Cancel executing test suites with a warning/confirmation prompt that terminates child test processes cleanly.
- **Rerun Button**: Quickly rerun the exact same test selection with a single click.

---

## 🛠️ Configuration Settings

### Custom Gherkin Formatter Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `smartBehave.formatting.customIndent.enabled` | `boolean` | `true` | Enable custom keyword indentation for Gherkin files. |
| `smartBehave.formatting.indentCharacter` | `string` | `"auto"` | Indent unit: `"auto"`, `"tab"`, or `"spaces"`. |
| `smartBehave.formatting.indent.feature` | `number` | `0` | Number of tabs/indents for `Feature:` headers. |
| `smartBehave.formatting.indent.scenario` | `number` | `1` | Number of tabs/indents for `Scenario:` headers. |
| `smartBehave.formatting.indent.background` | `number` | `1` | Number of tabs/indents for `Background:` headers. |
| `smartBehave.formatting.indent.given` | `number` | `2` | Number of tabs/indents for `Given` steps. |
| `smartBehave.formatting.indent.when` | `number` | `2` | Number of tabs/indents for `When` steps. |
| `smartBehave.formatting.indent.then` | `number` | `3` | Number of tabs/indents for `Then` steps. |
| `smartBehave.formatting.indent.and` | `number` | `4` | Number of tabs/indents for `And` steps. |
| `smartBehave.formatting.indent.but` | `number` | `4` | Number of tabs/indents for `But` steps. |
| `smartBehave.formatting.indent.examples` | `number` | `2` | Number of tabs/indents for `Examples:` headers. |
| `smartBehave.formatting.relativeAnd` | `boolean` | `false` | If true, `And`/`But` indent +1 tab relative to preceding step. |

### Cucumber Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cucumber.features` | `string[]` | `["src/test/**/*.feature", "features/**/*.feature", "tests/**/*.feature", "*specs*/**/*.feature"]` | Glob patterns for Gherkin `.feature` files. |
| `cucumber.glue` | `string[]` | `["*specs*/**/*.cs", "features/**/*.js", "features/**/*.jsx", "features/**/*.php", "features/**/*.py", "features/**/*.rs", "features/**/*.rb", "features/**/*.ts", "features/**/*.tsx", "features/**/*_test.go", "src/test/**/*.java", "tests/**/*.py", "tests/**/*.rs"]` | Glob patterns for step definitions across all languages. |
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
| `smartBehave.formatCustomGherkin` | `Smart Cucumber-Behave: Format Feature with Custom Indentation` | Format active `.feature` file using custom indentation levels. |
| `smartBehave.openConfiguration` | `Smart Behave: Open Configuration Screen` | Open the multi-language interactive configuration webview. |
| `smartBehave.selectConfigFile` | `Smart Behave: Select Configuration / Capabilities File` | QuickPick to switch active caps/config file. |
| `smartBehave.run` | `Smart Behave: Run` | Run the selected feature or scenario. |
| `smartBehave.debug` | `Smart Behave: Debug` | Debug the selected feature or scenario with `debugpy`. |
| `smartBehave.cancelRun` | `Smart Behave: Cancel Run` | Terminate running test process with confirmation. |
| `smartBehave.rerunLastRun` | `Smart Behave: Rerun Last Run` | Rerun the last executed test session. |
| `smartBehave.showLiveRun` | `Smart Behave: Show Live Run Panel` | Focus the Cucumber-Behave Live Run dashboard. |
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
