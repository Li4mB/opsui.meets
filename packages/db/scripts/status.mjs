import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadRootEnv } from "./load-root-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(rootDir, "src", "migrations");
loadRootEnv();
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL is required to run db:status.");
  process.exit(1);
}

const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
});

try {
  await sql`
    create table if not exists opsui_schema_migrations (
      id bigserial primary key,
      filename text not null unique,
      applied_at timestamptz not null default now()
    )
  `;

  const appliedRows = await sql`
    select filename, applied_at
    from opsui_schema_migrations
    order by filename asc
  `;
  const applied = new Map(appliedRows.map((row) => [row.filename, row.applied_at]));

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of migrationFiles) {
    const timestamp = applied.get(file);
    if (timestamp) {
      console.log(`APPLIED ${file} ${timestamp}`);
    } else {
      console.log(`PENDING ${file}`);
    }
  }

  console.log(`Total migrations: ${migrationFiles.length}`);
  console.log(`Applied migrations: ${applied.size}`);
  console.log(`Pending migrations: ${migrationFiles.length - applied.size}`);
} finally {
  await sql.end({ timeout: 5 });
}
