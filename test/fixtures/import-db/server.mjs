import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {fileURLToPath} from 'node:url';const root=fileURLToPath(new URL('../../../',import.meta.url));
const source=process.env.WORTKARTEN_IMPORT_TEST_BACKUP;if(!source)throw Error('Private test backup directory is required');
const db=await PGlite.create();await db.exec(fs.readFileSync(source+'/restore-empty-database.sql','utf8'));
await db.exec(fs.readFileSync(root+'/prisma/migrations/20261118180000_add_dictionary_import_batches/migration.sql','utf8'));
await db.exec('CREATE SCHEMA wortkarten_import_test');
const server=new PGLiteSocketServer({db,port:55439,host:'127.0.0.1'});server.addEventListener('connection',()=>{void db.exec('DEALLOCATE ALL')});await server.start();console.log('Isolated restored PostgreSQL-compatible import test server:55439');
process.on('SIGINT',async()=>{await server.stop();await db.close();process.exit(0)});
