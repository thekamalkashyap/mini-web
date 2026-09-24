import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  /* data/, img/, audio/ are symlinked from public/ so the dev server and
     builds serve the pipeline-extracted assets without copying them */
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
