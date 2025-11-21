import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite sẽ tự động load các biến môi trường bắt đầu bằng VITE_ từ file .env hoặc system env
  // Không cần dùng 'define' để polyfill process.env cho các biến này.
});