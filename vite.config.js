import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import circleDependency from 'vite-plugin-circular-dependency'
import { sentryVitePlugin } from '@sentry/vite-plugin'

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

// Sentry source-map upload only runs when SENTRY_AUTH_TOKEN is present.
// Without it the plugin is omitted entirely so local builds + Vercel
// builds without the secret keep working. The auth token is a build-time
// secret — it must NEVER be set as a VITE_* var, or it would be inlined
// into the client bundle.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryPlugins = sentryAuthToken
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: sentryAuthToken,
      }),
    ]
  : []

export default defineConfig({
  build: {
    // Generate source maps so Sentry can symbolicate stack traces. Use
    // 'hidden' so maps are emitted but not referenced in the bundle —
    // they get uploaded to Sentry and then deleted from the deploy
    // (the upload plugin handles that).
    sourcemap: 'hidden',
  },
  plugins: [
    react(),
    circleDependency({
      circleImportThrowErr: true,
    }),
    ...sentryPlugins,
  ],
})
