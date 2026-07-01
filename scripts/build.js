#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const I18N_SRC = path.join(ROOT_DIR, 'i18n');
const I18N_DIST = path.join(DIST_DIR, 'i18n');

// Load the repo-root .env (if present) so local/release builds can inject the OAuth client
// credentials without committing them. Does not override variables already in the env.
function loadRootEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

async function buildPlugin() {
  console.log('Building basecamp-issue-provider...');

  loadRootEnv();

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  await build({
    entryPoints: [path.join(SRC_DIR, 'plugin.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BASECAMP_CLIENT_ID': JSON.stringify(process.env.BASECAMP_CLIENT_ID || ''),
      'process.env.BASECAMP_CLIENT_SECRET': JSON.stringify(
        process.env.BASECAMP_CLIENT_SECRET || '',
      ),
    },
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  const manifestSrc = path.join(SRC_DIR, 'manifest.json');
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, path.join(DIST_DIR, 'manifest.json'));
  }

  const iconSrc = path.join(ROOT_DIR, 'icon.svg');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(DIST_DIR, 'icon.svg'));
    console.log('Copied icon.svg');
  }

  if (fs.existsSync(I18N_SRC)) {
    fs.mkdirSync(I18N_DIST, { recursive: true });
    for (const file of fs.readdirSync(I18N_SRC)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(I18N_SRC, file), path.join(I18N_DIST, file));
      }
    }
    console.log('Copied i18n files');
  }

  console.log('Build complete!');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
