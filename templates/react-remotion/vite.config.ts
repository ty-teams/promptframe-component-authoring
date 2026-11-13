import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { promptFramePreviewResources } from '@promptframe/cli/preview';

export default defineConfig({
  plugins: [react(), promptFramePreviewResources()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'remotion'],
    },
  },
});
