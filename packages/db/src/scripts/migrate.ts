import { runMigrations } from "../migrate";

const started = Date.now();

runMigrations()
  .then(() => {
    console.log(`Migrations applied in ${Date.now() - started}ms`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
