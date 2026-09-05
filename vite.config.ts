/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Kaolin-Assets 生产工程配置
// 测试：纯逻辑单测跑 node 环境（几何内核无 DOM 依赖）；组件测试（如需）后续加 jsdom
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
