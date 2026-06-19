import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname correctly for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Root will be inferred from the config file location (project root)
  
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias '@' to the 'src' directory relative to the project root
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000, // Frontend port
    proxy: {
      '/api': 'http://localhost:3001', // Forward API calls to Express
    },
  },
});
