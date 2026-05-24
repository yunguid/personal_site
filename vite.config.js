import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        montana: resolve(__dirname, 'src/montana_gallery.html'),
        yngMusic: resolve(__dirname, 'src/yng-music.html'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
      }
    }
  },
  css: {
    devSourcemap: true,
  },
  server: {
    open: true,
    port: 3000,
  }
});
