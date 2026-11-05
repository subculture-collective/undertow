#!/usr/bin/env python3
"""Qualify Undertow images and native restored data before API-only promotion."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = Path('/srv/apps/undertow')
STATE = Path.home() / '.local/state/fleet-deploy/undertow'
BACKUPS = Path('/srv/recovery/backups/undertow-ci')
REPOSITORY = 'https://git.subcult.tv/subculture-collective/undertow'
DATABASE_URL = 'postgres://undertow_fixture:fixture-only-password@database:5432/undertow_fixture'


def run(args, *, source=None, output=None, timeout=35):
    result = subprocess.run(args, stdin=source, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Qualification command failed; inspect its private checkpoint')
    return result.stdout


def inspect(name, kind='container'):
    return json.loads(run(['docker', kind, 'inspect', name]))[0]


def validate(image, revision):
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    metadata = inspect(image, 'image')
    assert metadata['Config']['Labels']['org.opencontainers.image.revision'] == revision
    assert metadata['Config']['Labels']['org.opencontainers.image.source'] == REPOSITORY
    return metadata['Id']


def migrations(image=None):
    program = r"""
const fs=require('fs'),crypto=require('crypto'),files={};
function walk(path){for(const e of fs.readdirSync(path,{withFileTypes:true})){
const p=path+'/'+e.name;if(e.isDirectory())walk(p);else files[p]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
walk('drizzle');files['dist/db/migrate.js']=crypto.createHash('sha256').update(fs.readFileSync('dist/db/migrate.js')).digest('hex');
console.log(JSON.stringify(files));
"""
    command = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', image] if image else ['docker', 'exec', 'undertow-api-1', 'node']
    return json.loads(run(command + ['-e', program]))


def quiescent():
    for name in run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=undertow',
                     '--filter', 'label=com.docker.compose.service=worker', '--format', '{{.Names}}']).splitlines():
        raise RuntimeError('A running render worker requires the native paired release path')
    count = run(['docker', 'exec', 'undertow-db-1', 'psql', '-X', '-U', 'undertow', '-d', 'undertow', '-Atc',
                 "SELECT count(*) FROM render_job WHERE status IN ('awaiting_upload','queued','running')"])
    assert count.strip() == b'0', 'Render jobs are active; retry after the native work completes'


@contextmanager
def database_fixture(pg_image, dump=None):
    network = db = None
    try:
        network = run(['docker', 'network', 'create', '--internal', 'undertow-ci-' + uuid.uuid4().hex[:12]]).decode().strip()
        db = run(['docker', 'run', '-d', '--rm', '--init', '--network', network, '--network-alias', 'database',
                  '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '--memory', '512m', '--cpus', '1',
                  '-e', 'POSTGRES_USER=undertow_fixture', '-e', 'POSTGRES_PASSWORD=fixture-only-password',
                  '-e', 'POSTGRES_DB=undertow_fixture', '--entrypoint', '/usr/bin/timeout', pg_image,
                  '-s', 'TERM', '-k', '5', '100', 'docker-entrypoint.sh', 'postgres']).decode().strip()
        for attempt in range(30):
            if subprocess.run(['docker', 'exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'undertow_fixture'], capture_output=True).returncode == 0:
                break
            time.sleep(0.3)
        else:
            raise RuntimeError('Disposable PostgreSQL did not become ready')
        if dump:
            with dump.open('rb') as source:
                run(['docker', 'exec', '-i', db, 'pg_restore', '-U', 'undertow_fixture', '-d', 'undertow_fixture',
                     '--no-owner', '--no-privileges', '--exit-on-error'], source=source)
        yield network, db
    finally:
        if db:
            subprocess.run(['docker', 'rm', '-f', db], capture_output=True)
        if network:
            subprocess.run(['docker', 'network', 'rm', network], capture_output=True)


def fingerprint(image, network):
    program = r"""
import pg from 'pg';import {createHash} from 'node:crypto';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const schema=(await db.query("SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN ('public','drizzle') ORDER BY table_schema,table_name,ordinal_position")).rows;
const constraints=(await db.query("SELECT n.nspname,c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.relname,k.conname")).rows;
const indexes=(await db.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename,indexname")).rows;
const enums=(await db.query("SELECT n.nspname,t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,t.typname,e.enumsortorder")).rows;
const names=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename")).rows;
const tables={};const ident=s=>'"'+s.replaceAll('"','""')+'"';
for(const t of names){const name=ident(t.schemaname)+'.'+ident(t.tablename);
 tables[name]=(await db.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(row_to_json(x)::text),',' ORDER BY md5(row_to_json(x)::text)),'')) AS digest FROM ${name} AS x`)).rows[0];}
await db.end();console.log(JSON.stringify({schema:createHash('sha256').update(JSON.stringify({columns:schema,constraints,indexes,enums})).digest('hex'),tables}));
"""
    return json.loads(run(['docker', 'run', '--rm', '--network', network, '--read-only',
                           '-e', 'DATABASE_URL=' + DATABASE_URL, '--entrypoint', 'node', image, '--input-type=module', '-e', program]))


@contextmanager
def application_fixture(image, network, renders=None):
    cid = None
    try:
        args = ['docker', 'create', '--rm', '--init', '--network', network, '--read-only', '--memory', '512m', '--cpus', '1',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '160',
                '--tmpfs', '/tmp:uid=1000,gid=1000,mode=1777,size=32m', '-e', 'DATABASE_URL=' + DATABASE_URL,
                '-e', 'PUBLIC_URL=https://undertow.subcult.tv', '-e', 'AUTH_SECRET=' + uuid.uuid4().hex]
        if renders:
            args += ['--mount', 'type=bind,src=' + str(renders) + ',dst=/app/server/data/renders']
        else:
            args += ['--tmpfs', '/app/server/data/renders:uid=1000,gid=1000,mode=0700']
        for name in ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
                     'BREVO_API_KEY', 'SMTP_URL', 'STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CREATOR_PRICE_ID',
                     'STRIPE_PORTAL_CONFIGURATION_ID', 'WORKER_SECRET']:
            args += ['-e', name + '=']
        args += ['--entrypoint', '/usr/bin/timeout', image, '-s', 'TERM', '-k', '5', '75', 'sh', '-c',
                 'node dist/db/migrate.js && exec node dist/index.js']
        cid = run(args).decode().strip(); run(['docker', 'start', cid])
        for attempt in range(30):
            if subprocess.run(['docker', 'exec', cid, 'wget', '-q', '-T', '2', '-O', '/dev/null', 'http://127.0.0.1:8787/healthz'], capture_output=True).returncode == 0:
                break
            time.sleep(0.3)
        else:
            raise RuntimeError('Restored application did not become ready')
        yield cid
    finally:
        if cid:
            subprocess.run(['docker', 'rm', '-f', cid], capture_output=True)


def check_public(cid):
    program = r"""
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const origin='http://127.0.0.1:8787',root='/app/web';let count=0;
async function walk(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,e.name);if(e.isDirectory())await walk(file);else if(e.isFile()){
 const url=file===root+'/index.html'?'/':file.slice(root.length);const response=await fetch(origin+url);assert.equal(response.status,200,url);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(file),url);count++;}}}
await walk(root);const html=await(await fetch(origin+'/')).text();
assert.ok(html.includes('https://undertow.subcult.tv/'));assert.ok(html.includes('summary_large_image'));
assert.equal((await fetch(origin+'/healthz')).status,200);
console.log(JSON.stringify({result:'PASS',public_files:count,provider_network:'disabled'}));
"""
    return json.loads(run(['docker', 'exec', cid, 'node', '--input-type=module', '-e', program]))


def restic(args, output=None):
    return run(['sudo', '-n', '/usr/bin/env', 'RESTIC_PASSWORD_FILE=/etc/dozor-kvant-backup/restic-password',
                '/usr/bin/timeout', '--signal=TERM', '--kill-after=5s', '25s', '/usr/bin/restic',
                '-r', 'sftp:kvant-backup:/mnt/data3/backups/dozor/restic',
                '-o', 'sftp.args=-o BatchMode=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=2', *args],
               output=output, timeout=32)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def qualify(image, revision):
    os.umask(0o077); image = validate(image, revision)
    registration = json.loads((STATE / 'registration.json').read_text())
    assert digest(ROOT / 'deploy/undertow.env') == registration['env_file_sha256']
    current = inspect('undertow-api-1'); quiescent()
    assert migrations(image) == migrations(), 'Migration changes require native database release admission'
    directory = BACKUPS / (revision + '-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(mode=0o700)
    checkpoint = {'revision': revision, 'image': image, 'previous_image': current['Image'], 'stage': 'backup'}
    record = directory / 'qualification.json'
    def save(stage):
        checkpoint['stage'] = stage; record.write_text(json.dumps(checkpoint, indent=2) + '\n')
    save('backup'); dump = directory / 'database.dump'; media = directory / 'renders.tar'
    with dump.open('xb') as output:
        run(['docker', 'exec', 'undertow-db-1', 'pg_dump', '-U', 'undertow', '-d', 'undertow', '-Fc'], output=output)
    with media.open('xb') as output:
        run(['docker', 'exec', 'undertow-api-1', 'tar', '-C', '/app/server/data/renders', '-cf', '-', '.'], output=output)
    quiescent(); save('encrypted-offhost-backup')
    paths = [dump, media, ROOT / 'deploy/undertow.env', Path(__file__),
             Path.home() / '.config/fleet-deploy/undertow.json', Path.home() / '.config/fleet-deploy/undertow-compose.json']
    events = restic(['backup', '--json', '--tag', 'undertow', '--tag', 'ci-deploy', *map(str, paths)])
    summary = next(json.loads(line) for line in events.splitlines() if json.loads(line).get('message_type') == 'summary')
    checkpoint['offhost_snapshot'] = summary['snapshot_id']
    for source in [dump, media]:
        recovered = directory / ('recovered-' + source.name)
        with recovered.open('xb') as output: restic(['dump', summary['snapshot_id'], str(source)], output)
        assert digest(source) == digest(recovered)
    save('isolated-restore'); renders = directory / 'restored-renders'; renders.mkdir(mode=0o700)
    with tarfile.open(directory / 'recovered-renders.tar') as archive: archive.extractall(renders, filter='data')
    with database_fixture(inspect('undertow-db-1')['Image'], directory / 'recovered-database.dump') as (network, db):
        before = fingerprint(image, network)
        with application_fixture(image, network, renders) as cid:
            checkpoint['image_checks'] = check_public(cid)
            assert fingerprint(image, network) == before, 'Restored candidate changed schema or records'
    quiescent()
    assert inspect('undertow-api-1')['Id'] == current['Id'] and digest(ROOT / 'deploy/undertow.env') == registration['env_file_sha256']
    checkpoint.update(result='qualified', schema_tables_counts='PASS', offhost_byte_exact_restore='PASS', providers='disabled')
    save('complete')
    print(json.dumps({key: checkpoint[key] for key in ['result', 'revision', 'image', 'offhost_snapshot', 'schema_tables_counts', 'offhost_byte_exact_restore']}))


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '--image-check':
        image = validate(sys.argv[2], sys.argv[3])
        with database_fixture('postgres:17-alpine') as (network, db):
            with application_fixture(image, network) as cid: print(json.dumps(check_public(cid)))
    else:
        assert len(sys.argv) == 1
        revision = run(['git', 'ls-remote', '--exit-code', REPOSITORY + '.git', 'refs/heads/main']).decode().split()[0]
        qualify('fleet-deploy/undertow/api:' + revision, revision)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Undertow qualification refused promotion; inspect the private checkpoint') from None
