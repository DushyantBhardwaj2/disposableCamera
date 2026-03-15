import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Set VITE_API_BASE_URL to your deployed Worker URL before building for production:
  //   VITE_API_BASE_URL=https://wedding-photo-api-prod.<account>.workers.dev npm run build
})
