import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import circleDependency from 'vite-plugin-circular-dependency'

// Production builds FAIL on any circular import. Dev (`vite`) tolerates
// them via lazy module resolution, but Rollup's production minifier
// hoists const re-exports and turns a cycle into a runtime TDZ error
// at module-eval time — the bug that took prod down on 2026-05-11.
//
// `circleImportThrowErr: true` is the plugin's default; setting it
// explicitly so the intent is visible at the config site.
//
// The plugin prints every file in each detected cycle by default,
// which is the diagnostic we want if one ever sneaks in.
//
// To intentionally allow a cycle in a single file (very rare — should
// require code-review pushback), add `// @circular-ignore` above the
// offending import statement and the plugin will skip that module.

export default defineConfig({
  plugins: [
    react(),
    circleDependency({
      circleImportThrowErr: true,
    }),
  ],
})
