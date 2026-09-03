import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // SCENRI_API points the dev studio at another server (a perf fixture on 4830, say); 4747 is the owner's.
  server: { proxy: { '/api': process.env.SCENRI_API ?? 'http://127.0.0.1:4747' } },
  build: { chunkSizeWarningLimit: 900 },
});
