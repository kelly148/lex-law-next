// Temporary config for schema-only migration generation (no live DB required).
// Used only during CI/build to generate migration SQL from schema.ts.
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: "mysql://localhost:3306/placeholder",
  },
});
