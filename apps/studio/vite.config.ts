import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // In a linked worktree packages/cli/scripts/worktree.ts sets SCENRI_UI_PORT
    // and SCENRI_API to that worktree's lane; 5173 and 4747 are the primary
    // checkout's. Strict only under a lane, so the primary keeps Vite's own
    // fallback when 5173 is busy.
    port: Number(process.env.SCENRI_UI_PORT ?? 5173),
    strictPort: Boolean(process.env.SCENRI_UI_PORT),
    // Vite's default host is `localhost`, which macOS binds as [::1] only; a lane
    // binds 127.0.0.1 so the printed URL and the busy-port probe mean the same socket.
    host: process.env.SCENRI_UI_PORT ? '127.0.0.1' : undefined,
    // SCENRI_API points the dev studio at another server (a perf fixture on 4830, say); 4747 is the owner's.
    proxy: { '/api': process.env.SCENRI_API ?? 'http://127.0.0.1:4747' },
  },
  build: { chunkSizeWarningLimit: 900 },
});
