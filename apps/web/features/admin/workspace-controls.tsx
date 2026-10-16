'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Input, Select, Textarea } from '../../components/ui/primitives';
import { useApi } from '@/components/api/api-provider';
import type { AdminModel as Model } from '@/lib/api/types';
import { download } from '../../lib/download';

type Policy = {
  id: string;
  scope: string;
  subject: string;
  dailyRequests: number | null;
  dailyTokens: number | null;
  perRequestTokens: number | null;
  dailySimulatedBudget: string | null;
};
type Settings = {
  externalBlocked: boolean;
  retentionDays: number;
  sensitiveMode: 'WARN' | 'BLOCK';
};
type Dashboard = {
  settings: Settings;
  policies: Policy[];
  users: { id: string; username: string; department: string }[];
  feedback: { modelId: string; feedback: number; _count: number }[];
  recentFeedback: {
    id: string;
    modelId: string;
    feedback: number;
    feedbackComment: string | null;
    updatedAt: string;
  }[];
  departmentUsage: {
    department: string;
    _count: number;
    _sum: { totalTokens: number | null; simulatedProviderCost: string | null };
  }[];
};

type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedModels: string[];
  allowedRoles: string[];
  temperature: number;
  maxOutputTokens: number;
  enabled: boolean;
};
const emptyTemplate = {
  name: '',
  description: '',
  systemPrompt: '',
  allowedModels: [] as string[],
  allowedRoles: ['USER', 'ADMIN'],
  temperature: 0.7,
  maxOutputTokens: 1024,
  enabled: true,
};
const emptyPolicy = {
  scope: 'USER',
  subject: '',
  dailyRequests: '',
  dailyTokens: '',
  perRequestTokens: '',
  dailySimulatedBudget: '',
};

export function WorkspaceControls() {
  const { request } = useApi();
  const [data, setData] = useState<Dashboard>(),
    [models, setModels] = useState<Model[]>([]),
    [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [settings, setSettings] = useState<Settings>({
    externalBlocked: false,
    retentionDays: 0,
    sensitiveMode: 'WARN',
  });
  const [template, setTemplate] = useState(emptyTemplate),
    [templateId, setTemplateId] = useState(''),
    [policy, setPolicy] = useState(emptyPolicy);
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const fetchAll = () =>
    Promise.all([
      request<Dashboard>('/admin/workspace'),
      request<Model[]>('/admin/models'),
      request<PromptTemplate[]>('/admin/workspace/templates'),
    ]);
  const apply = ([d, m, t]: Awaited<ReturnType<typeof fetchAll>>) => {
    setData(d);
    setSettings(d.settings);
    setModels(m);
    setTemplates(t);
  };
  const load = () => fetchAll().then(apply);
  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e) => setNotice(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(fn: () => Promise<unknown>, message = 'Saved') {
    setBusy(true);
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">Workspace controls</h2>
      {notice && (
        <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800">
          {notice}
        </p>
      )}
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">External access & retention</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={busy || !data}
            checked={settings.externalBlocked}
            onChange={(e) => {
              const next = { ...(data?.settings || settings), externalBlocked: e.target.checked };
              void act(
                () =>
                  request('/admin/workspace/settings', {
                    method: 'PATCH',
                    body: JSON.stringify(next),
                  }),
                next.externalBlocked
                  ? 'External providers paused; active streams stop within ~2 seconds'
                  : 'External policy resumed; provider configuration and quotas still apply',
              );
            }}
          />
          <span>Pause all external providers (kill switch)</span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Sensitive information policy
            <Select
              className="mt-1 w-full"
              value={settings.sensitiveMode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  sensitiveMode: e.target.value as 'WARN' | 'BLOCK',
                })
              }
            >
              <option value="WARN">Warn and require acknowledgment</option>
              <option value="BLOCK">Block external sends</option>
            </Select>
          </label>
          <label className="text-sm">
            Chat retention, days (0 = disabled)
            <Input
              type="number"
              min={0}
              max={3650}
              value={settings.retentionDays}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  retentionDays: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Checks include outgoing history, instructions, memories and retrieved excerpts. Regex detection is
          best-effort. Retention permanently removes message text, citations and feedback from inactive chats, including
          soft-deleted chats, in hourly batches; usage totals remain. Project documents and memories are managed
          separately.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              if (
                settings.retentionDays > 0 &&
                !window.confirm(
                  `Enable retention at ${settings.retentionDays} days? Inactive chat content will be permanently removed during the hourly sweep.`,
                )
              )
                return;
              void act(() =>
                request('/admin/workspace/settings', {
                  method: 'PATCH',
                  body: JSON.stringify(settings),
                }),
              );
            }}
          >
            Save policy
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              act(async () => {
                const p = await request<{
                  conversations: number;
                  retentionDays: number;
                }>('/admin/workspace/retention');
                window.alert(`${p.conversations} chats are eligible under the saved ${p.retentionDays}-day policy.`);
              }, 'Retention preview completed')
            }
          >
            Preview saved retention
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              act(async () => {
                const d = await request<{
                  content: string;
                  filename: string;
                }>('/admin/workspace/usage.csv');
                download(d.filename, d.content, 'text/csv');
              }, 'Exported latest 10,000 usage records')
            }
          >
            Export usage CSV
          </Button>
        </div>
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">Quotas & simulated budgets</h3>
        <p className="text-xs text-slate-500">
          UTC daily limits; blank = unlimited, 0 = blocked. All matching policies apply. Role/model/department limits
          are shared by that scope. In-flight requests reserve a conservative input estimate plus maximum output.
          Budgets use simulated provider cost in USD; they do not charge money.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">
            Scope
            <Select
              className="mt-1 w-full"
              value={policy.scope}
              onChange={(e) => setPolicy({ ...policy, scope: e.target.value, subject: '' })}
            >
              {['USER', 'ROLE', 'MODEL', 'DEPARTMENT'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            Subject
            {policy.scope === 'DEPARTMENT' ? (
              <Input
                value={policy.subject}
                onChange={(e) => setPolicy({ ...policy, subject: e.target.value })}
                placeholder="Engineering"
              />
            ) : (
              <Select
                className="mt-1 w-full"
                value={policy.subject}
                onChange={(e) => setPolicy({ ...policy, subject: e.target.value })}
              >
                <option value="">Select</option>
                {(policy.scope === 'USER'
                  ? (data?.users || []).map((u) => [u.id, u.username])
                  : policy.scope === 'MODEL'
                    ? models.map((m) => [m.id, m.displayName])
                    : [
                        ['USER', 'USER'],
                        ['ADMIN', 'ADMIN'],
                      ]
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </label>
          {(['dailyRequests', 'dailyTokens', 'perRequestTokens', 'dailySimulatedBudget'] as const).map((k) => (
            <label key={k} className="text-xs">
              {
                {
                  dailyRequests: 'Requests / day',
                  dailyTokens: 'Tokens / day',
                  perRequestTokens: 'Tokens / request',
                  dailySimulatedBudget: 'Simulated budget / day (USD)',
                }[k]
              }
              <Input
                type="number"
                min={0}
                step={k === 'dailySimulatedBudget' ? '0.000001' : '1'}
                value={policy[k]}
                placeholder="Unlimited"
                onChange={(e) => setPolicy({ ...policy, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <Button
          disabled={busy || !policy.subject}
          onClick={() =>
            act(async () => {
              await request('/admin/workspace/quotas', {
                method: 'POST',
                body: JSON.stringify({
                  ...policy,
                  ...Object.fromEntries(
                    ['dailyRequests', 'dailyTokens', 'perRequestTokens', 'dailySimulatedBudget'].map((k) => [
                      k,
                      policy[k as keyof typeof policy] === '' ? null : Number(policy[k as keyof typeof policy]),
                    ]),
                  ),
                }),
              });
              setPolicy(emptyPolicy);
            })
          }
        >
          Save quota
        </Button>
        <div className="overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {['Scope', 'Subject', 'Requests/day', 'Tokens/day', 'Tokens/request', 'Budget USD/day', 'Actions'].map(
                  (s) => (
                    <th key={s} className="p-2">
                      {s}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data?.policies.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.scope}</td>
                  <td>{data.users.find((u) => u.id === p.subject)?.username || p.subject}</td>
                  <td>{p.dailyRequests ?? '∞'}</td>
                  <td>{p.dailyTokens ?? '∞'}</td>
                  <td>{p.perRequestTokens ?? '∞'}</td>
                  <td>{p.dailySimulatedBudget ?? '∞'}</td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setPolicy({
                          scope: p.scope,
                          subject: p.subject,
                          dailyRequests: p.dailyRequests?.toString() ?? '',
                          dailyTokens: p.dailyTokens?.toString() ?? '',
                          perRequestTokens: p.perRequestTokens?.toString() ?? '',
                          dailySimulatedBudget: p.dailySimulatedBudget ?? '',
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            request(`/admin/workspace/quotas/${p.id}`, {
                              method: 'DELETE',
                            }),
                          'Quota removed',
                        )
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">Departments</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {data?.users.map((u) => (
            <label key={u.id} className="text-xs">
              {u.username}
              <Input
                defaultValue={u.department}
                key={`${u.id}-${u.department}`}
                maxLength={120}
                placeholder="Department; save on blur"
                onBlur={(e) => {
                  if (e.target.value !== u.department)
                    void act(() =>
                      request(`/admin/workspace/users/${u.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ department: e.target.value }),
                      }),
                    );
                }}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">Reports and quotas use current department membership. Today (UTC):</p>
        {data?.departmentUsage.map((d) => (
          <p key={d.department} className="text-sm">
            {d.department} · {d._count} requests · {d._sum.totalTokens || 0} tokens · simulated $
            {d._sum.simulatedProviderCost || 0}
          </p>
        ))}
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">Prompt templates & personas</h3>
        <Select
          aria-label="Select prompt template to edit"
          value={templateId}
          onChange={(e) => {
            const t = templates.find((t) => t.id === e.target.value);
            setTemplateId(e.target.value);
            setTemplate(
              t
                ? {
                    name: t.name,
                    description: t.description,
                    systemPrompt: t.systemPrompt,
                    allowedModels: t.allowedModels,
                    allowedRoles: t.allowedRoles,
                    temperature: t.temperature,
                    maxOutputTokens: t.maxOutputTokens,
                    enabled: t.enabled,
                  }
                : emptyTemplate,
            );
          }}
        >
          <option value="">New template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {!t.enabled ? ' (disabled)' : ''}
            </option>
          ))}
        </Select>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">
            Name
            <Input
              value={template.name}
              onChange={(e) => setTemplate({ ...template, name: e.target.value })}
              maxLength={120}
            />
          </label>
          <label className="text-xs">
            Description
            <Input
              value={template.description}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
              maxLength={500}
            />
          </label>
        </div>
        <label className="block text-xs">
          System instructions
          <Textarea
            rows={5}
            maxLength={6000}
            value={template.systemPrompt}
            onChange={(e) => setTemplate({ ...template, systemPrompt: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-4">
          {['USER', 'ADMIN'].map((r) => (
            <label className="text-sm" key={r}>
              <input
                type="checkbox"
                checked={template.allowedRoles.includes(r)}
                onChange={() =>
                  setTemplate({
                    ...template,
                    allowedRoles: toggle(template.allowedRoles, r),
                  })
                }
              />{' '}
              {r}
            </label>
          ))}
          <label className="text-sm">
            <input
              type="checkbox"
              checked={template.enabled}
              onChange={(e) => setTemplate({ ...template, enabled: e.target.checked })}
            />{' '}
            Enabled
          </label>
        </div>
        <p className="text-xs">Allowed models (none selected = all models the user is permitted to use)</p>
        <div className="flex flex-wrap gap-4">
          {models.map((m) => (
            <label key={m.id} className="text-xs">
              <input
                type="checkbox"
                checked={template.allowedModels.includes(m.id)}
                onChange={() =>
                  setTemplate({
                    ...template,
                    allowedModels: toggle(template.allowedModels, m.id),
                  })
                }
              />{' '}
              {m.displayName}
            </label>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">
            Temperature
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={template.temperature}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  temperature: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-xs">
            Max output tokens (also capped by server)
            <Input
              type="number"
              min={1}
              max={4096}
              value={template.maxOutputTokens}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  maxOutputTokens: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        <Button
          disabled={busy || !template.name.trim() || !template.systemPrompt.trim()}
          onClick={() =>
            act(async () => {
              const t = await request<PromptTemplate>(
                templateId ? `/admin/workspace/templates/${templateId}` : '/admin/workspace/templates',
                {
                  method: templateId ? 'PATCH' : 'POST',
                  body: JSON.stringify(template),
                },
              );
              setTemplateId(t.id);
            }, 'Template saved and audited')
          }
        >
          Save template
        </Button>
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">Response feedback</h3>
        <div className="flex flex-wrap gap-3">
          {data?.feedback.map((f) => (
            <span className="rounded-xl border p-3 text-sm" key={`${f.modelId}-${f.feedback}`}>
              {f.modelId} · {f.feedback === 1 ? '👍' : '👎'} {f._count}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Comments below are explicitly submitted to administrators. Chat prompts and answers are excluded.
        </p>
        {data?.recentFeedback.map((f) => (
          <p key={f.id} className="border-t py-2 text-xs">
            {new Date(f.updatedAt).toLocaleString()} · {f.modelId} · {f.feedback === 1 ? '👍' : '👎'}{' '}
            {f.feedbackComment || '(no comment)'}
          </p>
        ))}
      </Card>
    </section>
  );
}
