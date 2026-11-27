import { defineConfig } from "vite";

const instrumented = process.env.RUSEACT_INSTRUMENTED === "1";

export default defineConfig({
  define: {
    __RUSEACT_INSTRUMENTED__: instrumented,
  },
  build: {
    outDir: instrumented ? "dist-test" : "dist",
    rollupOptions: {
      input: {
        index: "index.html",
        hello: "hello.html",
        counter: "counter.html",
        conditional: "conditional.html",
        todo: "todo.html",
        reorderable: "reorderable.html",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
