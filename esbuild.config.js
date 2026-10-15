const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  // Prefer ESM entry points: jsonc-parser's UMD main does `require('./impl/...')` through a
  // wrapper parameter that esbuild cannot bundle, which fails at runtime.
  mainFields: ['module', 'main'],
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

const noVscodePlugin = {
  name: 'no-vscode',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, (args) => ({
      path: args.path,
      namespace: 'no-vscode-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'no-vscode-stub' }, () => ({
      contents: 'throw new Error("vscode is not available in CLI environment");',
      loader: 'js',
    }));
  },
};

const cliConfig = {
  entryPoints: ['./src/cli/main.ts'],
  bundle: true,
  outfile: './dist/cli.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  plugins: [noVscodePlugin],
  format: 'cjs',
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

const standaloneConfig = {
  entryPoints: ['./src/dev/standalone.ts'],
  bundle: true,
  outfile: './dist/standalone.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node18',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

function verifyVscodeFree(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Build verification failed: ${filePath} does not exist`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  if (
    content.includes("require('vscode')") ||
    content.includes('require("vscode")') ||
    content.includes("from 'vscode'") ||
    content.includes('from "vscode"') ||
    /require\s*\(\s*['"]vscode['"]\s*\)/.test(content) ||
    /from\s+['"]vscode['"]/.test(content)
  ) {
    throw new Error(
      `Build verification failed: ${filePath} contains forbidden vscode import/require reference`
    );
  }
}

/**
 * A bundle must be self-contained: a relative require left in the output (typically a UMD
 * package esbuild could not bundle) throws at runtime, i.e. at extension activation.
 */
function verifyNoRelativeRequires(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/require\s*\(\s*["']\.{1,2}\/[^"']*["']\s*\)/);
  if (match) {
    throw new Error(`Build verification failed: ${filePath} contains an unbundled relative require: ${match[0]}`);
  }
}

async function build() {
  try {
    if (watch) {
      const extCtx = await esbuild.context(extensionConfig);
      const cliCtx = await esbuild.context(cliConfig);
      const standaloneCtx = await esbuild.context(standaloneConfig);
      await Promise.all([extCtx.watch(), cliCtx.watch(), standaloneCtx.watch()]);
      console.log('Watching for changes...');
    } else {
      await Promise.all([
        esbuild.build(extensionConfig),
        esbuild.build(cliConfig),
        esbuild.build(standaloneConfig),
      ]);
      verifyVscodeFree('./dist/cli.js');
      verifyNoRelativeRequires('./dist/extension.js');
      verifyNoRelativeRequires('./dist/cli.js');
      verifyNoRelativeRequires('./dist/standalone.js');
      try {
        fs.chmodSync('./dist/cli.js', 0o755);
      } catch {
        // ignore on filesystems without chmod support
      }
      console.log('Build complete');
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

build();
