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
  target: 'node18',
  sourcemap: true,
  minify: !watch,
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

async function build() {
  try {
    if (watch) {
      const extCtx = await esbuild.context(extensionConfig);
      const cliCtx = await esbuild.context(cliConfig);
      await Promise.all([extCtx.watch(), cliCtx.watch()]);
      console.log('Watching for changes...');
    } else {
      await Promise.all([
        esbuild.build(extensionConfig),
        esbuild.build(cliConfig),
      ]);
      verifyVscodeFree('./dist/cli.js');
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
