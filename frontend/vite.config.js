import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api/products': {
        target: 'http://127.0.0.1:5003',
        changeOrigin: true
      },
      '/api/owner/products': {
        target: 'http://127.0.0.1:5003',
        changeOrigin: true
      },
      '/api/owner': {
        target: 'http://127.0.0.1:5004',
        changeOrigin: true
      },
      '/api/bookings': {
        target: 'http://127.0.0.1:5004',
        changeOrigin: true
      },
      '/api/wishlist': {
        target: 'http://127.0.0.1:5003',
        changeOrigin: true
      },
      '/api/users': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true
      },
      '/api/payments': {
        target: 'http://127.0.0.1:5005',
        changeOrigin: true
      },
      '/api/notifications': {
        target: 'http://127.0.0.1:5006',
        changeOrigin: true
      },
      '/api/auth': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true
      }
    }
  }
});
