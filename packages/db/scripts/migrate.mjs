import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const rootDir = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(rootDir, "src", "migrations");
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL is required to run db:migrate.");
  process.exit(1);
}

const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
});

try {
  await sql.begin(async (tx) => {
    await tx`
      create table if not exists opsui_schema_migrations (
        id bigserial primary key,
        filename text not null unique,
        applied_at timestamptz not null default now()
      )
    `;

    const appliedRows = await tx`
      select filename
      from opsui_schema_migrations
      order by filename asc
    `;
    const applied = new Set(appliedRows.map((row) => row.filename));

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    let appliedCount = 0;
    for (const file of migrationFiles) {
      if (applied.has(file)) {
        console.log(`SKIP ${file}`);
        continue;
      }

      const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8").trim();
      if (sqlText) {
        await tx.unsafe(sqlText);
      }

      await tx`
        insert into opsui_schema_migrations (filename)
        values (${file})
      `;
      appliedCount += 1;
      console.log(`APPLY ${file}`);
    }

    console.log(`Applied ${appliedCount} migration(s).`);
  });
} finally {
  await sql.end({ timeout: 5 });
}
