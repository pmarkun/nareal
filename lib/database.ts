import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
let instance:DatabaseSync|undefined;
export function rawDatabase(){
 if(instance)return instance;
 const path=process.env.DATABASE_PATH||'./data/nareal.sqlite';if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
 for(const name of readdirSync(join(process.cwd(),'migrations')).filter(n=>n.endsWith('.sql')).sort()){
  const sql=readFileSync(join(process.cwd(),'migrations',name),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
  const previous=db.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name);
  if(previous){if(previous.checksum!==checksum)throw Error('Migration modificada após aplicação: '+name);continue;}
  db.exec('BEGIN IMMEDIATE');try{db.exec(sql);db.prepare('INSERT INTO schema_migrations (name,checksum) VALUES (?,?)').run(name,checksum);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }
 instance=db;return db;
}
class Statement{readonly sql:string;readonly values:SQLInputValue[];constructor(sql:string,values:SQLInputValue[]=[]){this.sql=sql;this.values=values;}bind(...values:SQLInputValue[]){return new Statement(this.sql,values);}async first<T=Record<string,unknown>>(){return (rawDatabase().prepare(this.sql).get(...this.values)||null) as T|null;}async all<T=Record<string,unknown>>(){return {results:rawDatabase().prepare(this.sql).all(...this.values) as T[]};}async run(){const r=rawDatabase().prepare(this.sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}}
export function database(){return {prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{const db=rawDatabase();db.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements){const result=db.prepare(s.sql).run(...s.values);results.push({meta:{changes:Number(result.changes)}});}db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};}
