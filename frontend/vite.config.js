import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite automatically loads .env.production for `npm run build`.
  // Production API value should be:
  //   VITE_API_BASE_URL=https://disposable-camera-api.onrender.com
})
