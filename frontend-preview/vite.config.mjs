import { defineConfig } from 'vite';
export default defineConfig({ build: {
  lib: { entry:'chat.tsx', formats:['es'], fileName:'speakdobre-chat-preview' },
  commonjsOptions: { include:[/node_modules/, /session-adapter\.cjs/] },
  // Compile our adapter separately; the integration host must resolve these
  // pinned dependencies. This is not a standalone browser distribution.
  rollupOptions: { external: id => /^(react|react-dom|@cometchat\/)/.test(id) },
} });
