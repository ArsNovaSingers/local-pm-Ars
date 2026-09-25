// Restore a backup made by backup.mjs into a database.
//
//   node restore.mjs <gs://bucket/YYYY-MM-DD_HHMM/ | local folder> <target-db-name> [--i-mean-production]
//
// Reads DATABASE_URI for the cluster. The target database is DROPPED first, then every
// collection file is inserted. Restoring into the production database name ("local-pm")
// requires --i-mean-production: rehearse into a scratch name (e.g. local-pm-restore-test)
// first, look at it, then decide.
import { MongoClient, BSON } from 'mongodb';
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';

const [source, target] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const confirmed = process.argv.includes('--i-mean-production');
if (!source || !target) {
  console.error('usage: node restore.mjs <gs://bucket/prefix/ | folder> <target-db> [--i-mean-production]');
  process.exit(1);
}
if (target === 'local-pm' && !confirmed) {
  console.error('Refusing to overwrite the production database without --i-mean-production.');
  process.exit(1);
}

async function readFiles() {
  if (source.startsWith('gs://')) {
    const [, , bucketName, ...rest] = source.split('/');
    const prefix = rest.join('/').replace(/\/?$/, '/');
    const [files] = await new Storage().bucket(bucketName).getFiles({ prefix });
    const out = [];
    for (const f of files) {
      const base = path.posix.basename(f.name);
      if (base.endsWith('.json') && !base.startsWith('_')) out.push([base.slice(0, -5), (await f.download())[0].toString('utf8')]);
    }
    return out;
  }
  return fs.readdirSync(source)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => [f.slice(0, -5), fs.readFileSync(path.join(source, f), 'utf8')]);
}

const client = new MongoClient(process.env.DATABASE_URI.trim());
await client.connect();
const db = client.db(target);
const files = await readFiles();
if (!files.length) {
  console.error('No collection files found at', source);
  process.exit(1);
}
await db.dropDatabase();
for (const [name, body] of files) {
  const docs = BSON.EJSON.parse(body, { relaxed: false });
  if (docs.length) await db.collection(name).insertMany(docs);
  console.log(`${target}.${name}: ${docs.length}`);
}
await client.close();
