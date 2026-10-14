'use client';
import { KeyRound, Server, ShieldCheck, User } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { useApi } from '../lib/api';
import { Shell } from './shell';
import { Badge, Card } from './ui';

export function SettingsPage() {
  const auth = useAuth();
  const api = useApi();
  const profile = auth.user?.profile as { preferred_username?: string; email?: string; realm_access?: { roles?: string[] } };
  return <Shell active="settings"><div className="mx-auto max-w-4xl space-y-6 p-8"><div><p className="text-sm font-medium text-brand">SETTINGS</p><h1 className="mt-1 text-3xl font-semibold">Account & deployment</h1></div><div className="grid gap-5 md:grid-cols-2"><Card className="p-6"><User className="text-brand"/><h2 className="mt-4 font-semibold">Company identity</h2><dl className="mt-4 space-y-3 text-sm"><Row label="Username" value={profile.preferred_username || '—'}/><Row label="Email" value={profile.email || '—'}/><Row label="Roles" value={(profile.realm_access?.roles || []).filter((role) => ['ADMIN','USER'].includes(role)).join(', ')}/></dl></Card><Card className="p-6"><Server className="text-brand"/><h2 className="mt-4 font-semibold">Local deployment</h2><div className="mt-4 space-y-3 text-sm"><p><Badge tone="green">LOCAL BY DEFAULT</Badge></p><p className="text-slate-500">Every request routes through NestJS and LiteLLM. The default model is the local deterministic mock; Ollama and external providers stay disabled until an administrator explicitly enables them.</p><p className="text-slate-500">Local services still consume CPU, memory, disk, and electricity.</p><p><a className="font-medium text-brand underline" href={`${api.apiBase}/docs`} target="_blank" rel="noreferrer">API documentation (Swagger)</a></p></div></Card></div><Card className="p-6"><div className="flex gap-3"><ShieldCheck className="text-brand"/><div><h2 className="font-semibold">Privacy controls</h2><p className="mt-2 text-sm text-slate-500">Conversation ownership is enforced by the backend from the validated token subject. Administrators receive aggregate usage data, not private chat content. Full prompts and responses are not logged by default.</p></div></div><div className="mt-5 flex gap-3"><KeyRound className="text-brand"/><div><h2 className="font-semibold">Session</h2><p className="mt-2 text-sm text-slate-500">Authentication uses Keycloak Authorization Code Flow with PKCE. Use Logout in the sidebar to end the identity-provider session.</p></div></div></Card></div></Shell>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="font-medium">{value}</dd></div>; }

