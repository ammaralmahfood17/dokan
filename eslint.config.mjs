import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
// Audit T1 #3 / #20 (Wave 3 T3): jsx-a11y 6.10.2 already ships as a transitive dependency of
// eslint-config-next, so turning these on costs nothing and makes the class of defect that
// produced the 12 orphaned labels FAIL THE BUILD instead of waiting for the next audit.
// NOTE: do not register the plugin object here - eslint-config-next already does, and
// redefining it is a hard ConfigError ("Cannot redefine plugin jsx-a11y"). Adding rules is enough.

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // A <label> that is not programmatically associated with a control is decoration, not a
      // label: a screen reader announces "edit text" with no name.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Input", "Select", "Textarea"], depth: 3 },
      ],
      // A click handler on a non-interactive element is unreachable by keyboard.
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/aria-role": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "supabase/functions/**",
    // Generated report output, not source. Without this, `npm test --coverage`
    // leaves minified vendor bundles in coverage/ whose bundled eslint-disable
    // directives trip `--max-warnings 0` and block every commit.
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
