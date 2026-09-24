// Bundles pistatusline into dist/: the pi extension, the render worker, and the Ink editor.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import { patchParseKeypress } from './ink-backspace.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const inkBackspacePatch = {
    name: 'ink-backspace',
    setup(build) {
        build.onLoad({ filter: /[\\/]ink[\\/]build[\\/]parse-keypress\.js$/ }, (args) => ({
            contents: patchParseKeypress(fs.readFileSync(args.path, 'utf-8')),
            loader: 'js'
        }));
    }
};

// Bundled CommonJS dependencies call require() for Node built-ins, and ccstatusline's
// terminal.ts reads __dirname; ESM output provides neither on its own.
const banner = [
    `import { createRequire as __pistatuslineCreateRequire } from 'node:module';`,
    `import { fileURLToPath as __pistatuslineFileURLToPath } from 'node:url';`,
    `import { dirname as __pistatuslineDirname } from 'node:path';`,
    `const require = __pistatuslineCreateRequire(import.meta.url);`,
    `const __filename = __pistatuslineFileURLToPath(import.meta.url);`,
    `const __dirname = __pistatuslineDirname(__filename);`
].join('\n');

const common = {
    absWorkingDir: root,
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    jsx: 'automatic',
    // pi resolves its own packages for extensions; react-devtools-core only loads with DEV=true.
    external: ['@earendil-works/*', 'react-devtools-core'],
    banner: { js: banner },
    define: { 'process.env.DEV': '"false"', 'process.env.NODE_ENV': '"production"' },
    plugins: [inkBackspacePatch],
    metafile: true,
    logLevel: 'warning'
};

// pi loads the extension through jiti, so it must stay one self-contained file without Ink:
// jiti would otherwise transform the shared chunk and its top-level await.
const extension = await esbuild.build({ ...common, entryPoints: { extension: 'src/pi/extension.ts' } });
// The worker and the editor load as native ESM. Splitting keeps yoga-layout's top-level await
// valid: without it esbuild wraps lazily-imported modules in sync initialisers that await.
const native = await esbuild.build({
    ...common,
    entryPoints: {
        'render-worker': 'src/pi/render-worker.ts',
        'git-review-refresh': 'src/pi/git-review-refresh.ts',
        'tui-cli': 'src/pi/tui-cli.ts'
    },
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]'
});
const result = { metafile: { inputs: { ...extension.metafile.inputs, ...native.metafile.inputs }, outputs: { ...extension.metafile.outputs, ...native.metafile.outputs } } };

for (const file of Object.keys(result.metafile.outputs).filter(out => out.endsWith('.js'))) {
    const out = path.join(root, file);
    fs.writeFileSync(out, fs.readFileSync(out, 'utf-8').replaceAll('__PACKAGE_VERSION__', version));
}
fs.writeFileSync(path.join(root, 'dist', 'meta.json'), JSON.stringify(result.metafile));

for (const [file, info] of Object.entries(result.metafile.outputs)) {
    console.log(`${file}  ${(info.bytes / 1024).toFixed(0)} KB`);
}
