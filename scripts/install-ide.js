#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';

// Check possible Antigravity IDE CLI locations
const localAppData = process.env.LOCALAPPDATA || '';
const possiblePaths = [
  path.join(localAppData, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
  path.join(localAppData, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide'),
  'antigravity-ide'
];

let ideCli = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    ideCli = p;
    break;
  }
}

if (!ideCli) {
  console.log('Antigravity IDE CLI not found in standard paths, falling back to "code"...');
  ideCli = 'code';
}

const openvsxVsix = path.join(rootDir, `smart-cucumber-behave-openvsx-${version}.vsix`);
const vscodeVsix = path.join(rootDir, `smart-cucumber-behave-vscode-${version}.vsix`);
const vsixFiles = fs.existsSync(openvsxVsix) ? [openvsxVsix] : (fs.existsSync(vscodeVsix) ? [vscodeVsix] : []);

for (const vsix of vsixFiles) {
  if (fs.existsSync(vsix)) {
    console.log(`Installing ${path.basename(vsix)} into Antigravity IDE using: ${ideCli}...`);
    try {
      cp.execSync(`"${ideCli}" --install-extension "${vsix}" --force`, { stdio: 'inherit', cwd: rootDir });
      console.log(`✓ Installed ${path.basename(vsix)} successfully.\n`);
    } catch (e) {
      console.error(`Failed to install ${path.basename(vsix)}:`, e.message);
    }
  }
}

// Ensure Antigravity IDE's built-in symbol icon theme maps .feature files to the cucumber icon
try {
  const symbolThemePaths = [
    path.join(localAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'theme-symbols', 'src', 'symbol-icon-theme.json'),
  ];
  for (const stPath of symbolThemePaths) {
    if (fs.existsSync(stPath)) {
      const content = fs.readFileSync(stPath, 'utf8');
      const json = JSON.parse(content);
      let changed = false;
      if (!json.fileExtensions) json.fileExtensions = {};
      for (const ext of ['feature', 'features', 'story']) {
        if (json.fileExtensions[ext] !== 'cucumber') {
          json.fileExtensions[ext] = 'cucumber';
          changed = true;
        }
      }
      if (!json.languageIds) json.languageIds = {};
      for (const lang of ['gherkin', 'cucumber', 'behave', 'feature']) {
        if (json.languageIds[lang] !== 'cucumber') {
          json.languageIds[lang] = 'cucumber';
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(stPath, JSON.stringify(json, null, 2), 'utf8');
        console.log(`✓ Patched ${stPath} with Cucumber icon mappings for Agent context.\n`);
      }
    }
  }
} catch (e) {
  console.warn('Could not patch Antigravity IDE symbol icon theme:', e.message);
}
