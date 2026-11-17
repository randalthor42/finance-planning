/**
 * @file Runs the data migrations (src/models/migrations.js) on a file, outside the app. See docs/data.md.
 *
 *   node scripts/migrate.mjs <input.json> [output.json]
 *
 * The input can be:
 * - the stored database: the value of localStorage "runway.db.v1", or the text of a backup kept before a migration
 *   (IndexedDB "runway" › backups);
 * - an exported backup (Settings › Backup, not encrypted) or a data file (Settings › Storage).
 * The output has the same shape, migrated to the current schema (a backup stays a backup: "Import backup" opens it).
 * Without an output file it is printed. The input file is never changed unless it is also the output. Migrations
 * only add: no data is dropped, and running one again changes nothing.
 */
import fs from 'node:fs';
import { SCHEMA_VERSION, migrate, versionOf } from '../src/models/migrations.js';

const [input, output] = process.argv.slice(2);
/** Messages go to stderr when the data itself goes to stdout, so `node scripts/migrate.mjs a.json > b.json` works. */
const say = output ? console.log : console.error;
if (!input) {
  console.error('Usage: node scripts/migrate.mjs <input.json> [output.json]');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
if (data && data.kind === 'encrypted') {
  console.error(
    'This backup is encrypted: import it in the app (Settings › Backup), which migrates it, then export it again.',
  );
  process.exit(1);
}
// a backup or data file lists its plans; the stored database keys them by id
const isFile = data && (data.kind === 'backup' || data.kind === 'data') && Array.isArray(data.plans);
const db = isFile
  ? { ...data, v: data.v, plans: Object.fromEntries(data.plans.map((p, i) => [p.id || 'plan' + i, p])) }
  : data;
const from = versionOf(db);
if (from >= SCHEMA_VERSION) {
  say(`${input}: already schema ${from}; nothing to migrate.`);
  process.exit(0);
}
const result = migrate(db);
const out = isFile ? { ...result.db, plans: Object.values(result.db.plans) } : result.db;
if (isFile) {
  delete out.deletedPlans; // only the stored database keeps deleted plans
}
const text = JSON.stringify(out, null, isFile ? 1 : 0);
const plans = Object.values(result.db.plans || {});
say(`${input}: schema ${result.from} → ${result.to} (${result.applied.join('; ')}), ${plans.length} plan(s).`);
if (output) {
  fs.writeFileSync(output, text);
  console.log(`written to ${output}`);
} else {
  process.stdout.write(text + '\n');
}
