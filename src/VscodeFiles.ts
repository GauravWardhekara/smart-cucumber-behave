import { Files } from '@cucumber/language-server';
import { FileSystem, Uri, workspace } from 'vscode';

/**
 * Normalizes Python Behave step definition decorators so they are 100% compatible
 * with @cucumber/language-service and @cucumber/language-server tree-sitter AST queries
 * and Cucumber Expression parsing.
 *
 * This runs purely in-memory when the language server indexes step definitions,
 * without modifying the actual source files on disk or altering line counts.
 */
export function normalizeBehavePythonForCucumber(pySource: string): string {
  // 1. Remove behave. prefix from decorators: @behave.given -> @given
  let res = pySource.replace(/@\s*behave\s*\.\s*(given|when|then|step)\b/gi, '@$1');

  // 2. Fix raw/unicode prefixes on triple quotes: @given(r"""...""") -> @given("""...""")
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*[rRuU]{1,2}("""|''')/gi, '@$1($2');

  // 3. Fix triple-quoted strings in step decorators: @given("""...""") -> @given("...")
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*("""|''')([\s\S]*?)\2\s*\)/gi, (_match, kw, q3, content) => {
    const q1 = q3 === '"""' ? '"' : "'";
    return `@${kw}(${q1}${content}${q1})`;
  });

  // 4. Fix raw/unicode string prefixes: r"...", u"...", ur"...", ru"..." in step decorators
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*[rRuU]{1,2}(['"])/gi, '@$1($2');

  // 5. Normalize step expressions inside step decorators
  const standardCucumberTypes = new Set([
    'int', 'float', 'word', 'string', 'double', 'bigdecimal', 'byte', 'short', 'long', 'biginteger', ''
  ]);

  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2\s*\)/gi, (_match, kw, q, pattern) => {
    // If it's a regex: starts with ^ or ends with $, or contains (?P< or regex backslashes without Behave parse placeholders
    if (/^\^|(?:\(\?P<)|(?:\(\\[dswDSW]\+?\))|\$$/.test(pattern) && !/\{[a-zA-Z0-9_]+(?::[a-zA-Z0-9_]+)?\}/.test(pattern)) {
      // Python regex named group: (?P<name>...) -> (...)
      const cleanPattern = pattern.replace(/\(\?P<[a-zA-Z0-9_]+>/g, '(');
      return `@${kw}(${q}${cleanPattern}${q})`;
    }

    let p = pattern;

    // Replace Behave placeholders: {name:d}, {name:f}, {name:w}, {name:s}, {name}
    p = p.replace(/\{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?\}/g, (placeholder: string, name: string, type?: string) => {
      // If user literally wrote {int}, {float}, {word}, {string}, preserve it
      if (!type && standardCucumberTypes.has(name)) {
        return placeholder;
      }
      if (type === 'd' || type === 'n') {
        return '{int}';
      }
      if (type === 'f') {
        return '{float}';
      }
      if (type === 'w') {
        return '{word}';
      }
      if (type === 's') {
        return '{string}';
      }
      // For any custom or named parameters ({thing}, {cost:price}), replace with anonymous {}
      return '{}';
    });

    return `@${kw}(${q}${p}${q})`;
  });

  return res;
}

export class VscodeFiles implements Files {
  constructor(private readonly fs: FileSystem) {}

  async exists(uri: string): Promise<boolean> {
    try {
      await this.fs.stat(Uri.parse(uri));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(uri: string): Promise<string> {
    const parsedUri = Uri.parse(uri);
    // 1. If file is open in editor (supports dirty/unsaved edits), use document text
    const openDoc = workspace.textDocuments.find(
      (doc) => doc.uri.toString() === uri || doc.uri.fsPath === parsedUri.fsPath
    );
    let content: string;
    if (openDoc) {
      content = openDoc.getText();
    } else {
      const data = await this.fs.readFile(parsedUri);
      content = new TextDecoder().decode(data);
    }

    // 2. If it is a Python file, normalize Behave step definitions in-memory
    if (uri.endsWith('.py') || parsedUri.path.endsWith('.py')) {
      return normalizeBehavePythonForCucumber(content);
    }

    return content;
  }

  async findUris(glob: string): Promise<readonly string[]> {
    const uris = await workspace.findFiles(glob);
    const results = new Set(uris.map((file) => file.toString()));

    // When querying Python glue, ensure all standard Behave steps directories are scanned
    if (glob.includes('.py')) {
      const behaveGlobs = [
        '**/steps/**/*.py',
        'steps/**/*.py',
        '**/*_steps.py',
        '**/step_*.py',
        '**/steps.py',
        'features/**/*.py',
        'tests/**/*.py',
      ];
      for (const bg of behaveGlobs) {
        if (bg !== glob) {
          const extraUris = await workspace.findFiles(bg);
          for (const u of extraUris) {
            results.add(u.toString());
          }
        }
      }
    }

    return Array.from(results);
  }

  relativePath(uri: string): string {
    return workspace.asRelativePath(Uri.parse(uri), true);
  }
}
