import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  splitting: false,
  target: "es2022",
  outDir: "dist",
  cjsInterop: true,
  shims: false,
  external: [],
  esbuildOptions(options) {
    options.drop = ["debugger"];
  },
});
