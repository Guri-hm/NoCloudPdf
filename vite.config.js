import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        outDir: 'wwwroot/js/bundle',
        rollupOptions: {
            input: 'wwwroot/js/main.js', // ここにエントリポイントとなるjsファイルを指定
            output: {
                entryFileNames: 'bundle.min.js',
                format: 'iife', // グローバルスコープで使う場合はiife
            }
        },
        minify: 'terser' // ミニファイ方法
    }
});