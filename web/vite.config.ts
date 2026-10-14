import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately; forward /v1 calls to it so the
// browser sees one origin and no CORS setup is needed.
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: apiUrl, changeOrigin: true },
    },
  },
});
