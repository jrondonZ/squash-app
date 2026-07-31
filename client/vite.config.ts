import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  build: {
    // Rails serves the built client straight out of public/.
    outDir: '../public',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        // three.js dwarfs everything else; splitting it lets the menu paint
        // before the renderer has finished downloading.
        manualChunks(id: string) {
          if (/node_modules[/\\](three|@react-three)[/\\]/.test(id)) return 'three';
          return undefined;
        },
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/cable': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
