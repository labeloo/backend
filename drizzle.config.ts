import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Must resolve to the same file the server opens (src/config.ts DATABASE_URL),
// otherwise migrations land in one database and queries run against another.
const url = (process.env.DATABASE_URL || 'file:database.db').replace(/^file:/, '');

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: { url },
});
