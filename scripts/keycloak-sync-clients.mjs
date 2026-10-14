// Keycloak imports infra/keycloak/enterprise-ai-realm.json only when the realm does not
// exist yet. This adds clients that were introduced later (e.g. enterprise-ai-swagger)
// to an existing local install. Existing clients are left untouched.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const realm = JSON.parse(readFileSync(new URL('../infra/keycloak/enterprise-ai-realm.json', import.meta.url), 'utf8'));

function kcadm(args, input) {
  // Runs inside the container so the admin credentials come from its own environment.
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'keycloak', 'sh', '-c', `/opt/keycloak/bin/kcadm.sh ${args}`], { input, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`kcadm ${args.split(' ')[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

kcadm('config credentials --server http://localhost:8080 --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"');
for (const client of realm.clients) {
  const existing = JSON.parse(kcadm(`get clients -r ${realm.realm} -q clientId=${client.clientId} --fields id`) || '[]');
  if (existing.length) {
    console.log(`${client.clientId}: exists, unchanged`);
    continue;
  }
  kcadm(`create clients -r ${realm.realm} -f -`, JSON.stringify(client));
  console.log(`${client.clientId}: created`);
}
