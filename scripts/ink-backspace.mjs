// ccstatusline ships ink 6.2.0 with this patch (patches/ink@6.2.0.patch): on macOS \x7f is the
// backspace key, so without it backspace deletes nothing in the editor's text inputs.
// The build applies it while bundling; `npm test` applies it to node_modules first, so the
// vendored TUI tests exercise the same ink the bundle ships (ccstatusline uses bun's
// patchedDependencies for this).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = `else if (s === '\\x7f' || s === '\\x1b\\x7f') {`;

export function patchParseKeypress(source) {
    const at = source.indexOf(TARGET);
    if (at < 0) {
        throw new Error('ink parse-keypress.js changed; update the backspace patch');
    }
    const end = source.indexOf('}', at);
    const block = source.slice(at, end);
    return source.slice(0, at) + block.replace(`key.name = 'delete';`, `key.name = 'backspace';`) + source.slice(end);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const file = path.join(root, 'node_modules', 'ink', 'build', 'parse-keypress.js');
    fs.writeFileSync(file, patchParseKeypress(fs.readFileSync(file, 'utf-8')));
}
