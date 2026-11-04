import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.env.TEMP, 'sp-cat-test.db');
if (fs.existsSync(out)) fs.unlinkSync(out);
const db = new DatabaseSync('D:/Project/sp/server/sp.db');
db.exec(`VACUUM INTO '${out.replaceAll('\\', '/')}'`);
db.close();
console.log(out, fs.statSync(out).size);
