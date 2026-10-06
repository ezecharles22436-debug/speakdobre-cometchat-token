import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Preserve the pinned vendor UMD intact instead of reparsing it through Rollup.
// The entry loads it before importing any UI Kit code. No remote CDN or auth key.
export default defineConfig({
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{
    name: 'pinned-chat-sdk',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@cometchat/chat-sdk-javascript') return '\0chat-sdk-global';
      if (id === '@cometchat/calls-sdk-javascript') return '\0calls-sdk-global';
    },
    load(id) {
      if (id === '\0chat-sdk-global') return 'export const { CometChat, CometChatException, PIN_SAVE_SENTINELS } = window; if (!CometChat) throw Error("Chat SDK has not loaded");';
      if (id === '\0calls-sdk-global') return 'const sdk = window["@cometchat/calls-sdk-javascript"]; if (!sdk) throw Error("Calls SDK has not loaded"); export const { CometChatCalls, CallLog, CallSession, Transcription } = sdk; export default sdk.default;';
    },
    generateBundle: { order: 'post', handler(options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'vendor/chat-sdk-4.2.0.js', source: readFileSync(resolve('node_modules/@cometchat/chat-sdk-javascript/CometChat.js')) });
      // Vendor UMD still contains one build-time Node environment expression.
      // Resolve only that expression; do not add a global process shim.
      const calls = readFileSync(resolve('node_modules/@cometchat/calls-sdk-javascript/dist/index.umd.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'vendor/calls-sdk-5.0.6.js', source: calls.replaceAll('process.env.NODE_ENV', '"production"') });
      const host = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && /[\\/]preview-host\.mjs$/.test(item.facadeModuleId || ''));
      if (!host) throw Error('Authenticated Preview entry missing');
      const css = Object.keys(bundle).filter(name => name.endsWith('.css') && !name.includes('controls-preview'));
      this.emitFile({ type: 'asset', fileName: 'preview-manifest.json', source: JSON.stringify({ entry: host.fileName, css }) });
      this.emitFile({ type: 'asset', fileName: 'preview-loader.mjs', source: readFileSync(resolve('preview-loader.mjs'), 'utf8') });
    } },
  }],
  build: {
    outDir: 'browser-dist',
    commonjsOptions: { include: [/node_modules/, /session-adapter\.cjs/] },
    rollupOptions: { input: ['browser.html', 'controls-preview.html', 'preview-host.mjs'], preserveEntrySignatures: 'strict' },
  },
});
