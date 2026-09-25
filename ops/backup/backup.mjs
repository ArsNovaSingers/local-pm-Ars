// Nightly Local PM backup + Trash purge (LPM-2). Runs as the Cloud Run Job `local-pm-backup`.
//
//   1. Dump every collection as canonical EJSON to gs://$BUCKET/YYYY-MM-DD_HHMM/<collection>.json
//      plus _summary.json. Canonical (not relaxed) EJSON keeps ObjectIds and dates exact, so
//      restore.mjs puts back byte-for-byte what was there.
//   2. AFTER the dump succeeds, permanently remove Trash items older than TRASH_DAYS (30):
//      tickets, projects, milestones, comments with deletedAt < now - 30 days. A purged item
//      is therefore always in at least the backup taken the same night.
//
// Env: DATABASE_URI (from Secret Manager), BUCKET, TRASH_DAYS (default 30), DRY_RUN=true to
// skip the purge and the upload (prints what it would do).
import { MongoClient, BSON } from 'mongodb';
import { Storage } from '@google-cloud/storage';

const uri = process.env.DATABASE_URI?.trim();
const bucketName = process.env.BUCKET?.trim();
const trashDays = Number(process.env.TRASH_DAYS ?? 30);
const dryRun = process.env.DRY_RUN === 'true';
if (!uri || !bucketName) {
  console.error('DATABASE_URI and BUCKET are required');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const client = new MongoClient(uri);
const bucket = new Storage().bucket(bucketName);

try {
  await client.connect();
  const db = client.db();
  const summary = {};

  for (const { name } of await db.listCollections().toArray()) {
    const docs = await db.collection(name).find({}).toArray();
    const body = BSON.EJSON.stringify(docs, { relaxed: false });
    if (!dryRun) await bucket.file(`${stamp}/${name}.json`).save(body, { contentType: 'application/json', resumable: false });
    summary[name] = docs.length;
  }
  const meta = { db: db.databaseName, at: new Date().toISOString(), summary };
  if (!dryRun) await bucket.file(`${stamp}/_summary.json`).save(JSON.stringify(meta, null, 2), { contentType: 'application/json' });
  console.log(JSON.stringify({ event: 'backup', prefix: `gs://${bucketName}/${stamp}/`, ...meta }));

  const cutoff = new Date(Date.now() - trashDays * 864e5);
  const purged = {};
  for (const name of ['tickets', 'projects', 'milestones', 'comments']) {
    const filter = { deletedAt: { $ne: null, $lt: cutoff } };
    purged[name] = dryRun
      ? await db.collection(name).countDocuments(filter)
      : (await db.collection(name).deleteMany(filter)).deletedCount;
  }
  console.log(JSON.stringify({ event: 'trash-purge', olderThan: cutoff.toISOString(), dryRun, purged }));
} catch (err) {
  console.error(JSON.stringify({ event: 'backup-failed', error: String(err?.stack ?? err) }));
  process.exitCode = 1;
} finally {
  await client.close();
}
