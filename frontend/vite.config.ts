
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react-swc';
  import tailwindcss from '@tailwindcss/vite';
  import path from 'path';

  export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      // Figma's export emits version-pinned import specifiers
      // (`import { X } from 'sonner@2.0.3'`), which Node/Vite cannot resolve.
      // These aliases map each back to the real package name. Only packages
      // actually imported by src/ are listed — the rest were removed along with
      // their unused dependencies.
      alias: {
        'sonner@2.0.3': 'sonner',
        'next-themes@0.4.6': 'next-themes',
        'lucide-react@0.487.0': 'lucide-react',
        'class-variance-authority@0.7.1': 'class-variance-authority',
        'figma:asset/5007331c79bebd08d33e495d8e37bb9954759a00.png': path.resolve(__dirname, './src/assets/5007331c79bebd08d33e495d8e37bb9954759a00.png'),
        '@radix-ui/react-tabs@1.1.3': '@radix-ui/react-tabs',
        '@radix-ui/react-slot@1.1.2': '@radix-ui/react-slot',
        '@radix-ui/react-select@2.1.6': '@radix-ui/react-select',
        '@radix-ui/react-scroll-area@1.2.3': '@radix-ui/react-scroll-area',
        '@radix-ui/react-label@2.1.2': '@radix-ui/react-label',
        '@radix-ui/react-dropdown-menu@2.1.6': '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-dialog@1.1.6': '@radix-ui/react-dialog',
        '@radix-ui/react-alert-dialog@1.1.6': '@radix-ui/react-alert-dialog',
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      target: 'esnext',
      outDir: 'build',
    },
    server: {
      port: 3000,
      // Don't auto-open a browser inside a Docker container — there's nothing to open.
      open: !process.env.IN_DOCKER,
      host: true,
      // Docker bind-mounts on Linux don't propagate inotify events into the
      // container, so Vite's native file watcher never sees host edits and HMR
      // goes silent. Polling forces the watcher to re-stat files so edits made
      // on the host actually hot-reload the browser tab.
      watch: { usePolling: true, interval: 150 },
      proxy: {
        '/api': {
          // VITE_DEV_API_PROXY is set in docker-compose.dev.yml to point at the
          // `api` service. Bare-metal dev falls back to the local backend.
          target: process.env.VITE_DEV_API_PROXY || 'http://localhost:8080',
          changeOrigin: true,
        },
        // Wiki image uploads land at /uploads/wiki/<file> served by the
        // backend's static handler. Mirror the /api proxy so <img src="/uploads/…">
        // works in the dev SPA without hardcoding the backend port.
        '/uploads': {
          target: process.env.VITE_DEV_API_PROXY || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  });