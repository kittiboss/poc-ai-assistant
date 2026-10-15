import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { login, request, api } from "./test-client.mjs";

const alice = await login(
  "employee1",
  process.env.EMPLOYEE_DEMO_PASSWORD || "Employee123!",
);
const bob = await login(
  "employee2",
  process.env.EMPLOYEE_DEMO_PASSWORD || "Employee123!",
);
const admin = await login(
  "admin",
  process.env.ADMIN_DEMO_PASSWORD || "Admin123!",
);
const tag = `workspace-test-${Date.now()}`;
const cleanup = [];
async function json(
  path,
  actor,
  method = "GET",
  data,
  status = method === "POST" ? 201 : 200,
) {
  const response = await request(path, actor.token, {
    method,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(body)}`,
  );
  return body;
}
async function chat(actor, id, text, extra = {}) {
  const response = await request(`/conversations/${id}/messages`, actor.token, {
    method: "POST",
    body: JSON.stringify({
      content: text,
      modelId: "local-mock",
      requestId: randomUUID(),
      ...extra,
    }),
  });
  const body = await response.text();
  return { status: response.status, body };
}
async function upload(projectId, filename, content, expected = 201) {
  const data = new FormData();
  data.append("file", new Blob([content]), filename);
  const response = await fetch(
    `${api}/workspace/projects/${projectId}/sources`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.token}` },
      body: data,
    },
  );
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

try {
  const project = await json("/workspace/projects", alice, "POST", {
    name: tag,
    instructions: "Answer using the handbook. Use citations.",
  });
  cleanup.push(() =>
    json(`/workspace/projects/${project.id}`, alice, "DELETE"),
  );
  const source = await upload(
    project.id,
    "handbook.txt",
    "Annual leave allowance is 18 days. Employees request leave through their manager. นโยบายวันลา: ลาพักร้อนได้ 18 วันต่อปี",
  );
  await upload(project.id, "unsupported.exe", "text", 400);
  assert.equal(
    (await request(`/workspace/sources/${source.id}`, bob.token)).status,
    404,
  );
  assert.equal(
    (
      await request(`/workspace/projects/${project.id}`, bob.token, {
        method: "PATCH",
        body: JSON.stringify({ name: "stolen", instructions: "" }),
      })
    ).status,
    404,
  );
  const tool = await json("/workspace/tools", alice, "POST", {
    tool: "search",
    input: "leave allowance",
    projectId: project.id,
  });
  assert(tool.text.includes("18 days"));
  const thai = await json("/workspace/tools", alice, "POST", {
    tool: "search",
    input: "นโยบายวันลา",
    projectId: project.id,
  });
  assert(thai.text.includes("18"));
  await json(
    "/workspace/tools",
    bob,
    "POST",
    { tool: "search", input: "leave", projectId: project.id },
    404,
  );
  await json(
    "/workspace/tools",
    alice,
    "POST",
    { tool: "shell", input: "whoami" },
    400,
  );
  assert.equal(
    (
      await json("/workspace/tools", alice, "POST", {
        tool: "calculator",
        input: "(125+75)*1.07",
      })
    ).text,
    "(125+75)*1.07 = 214",
  );
  const csv = await json("/workspace/tools", alice, "POST", {
    tool: "csv",
    input: "name,note\nAlice,=1+1",
  });
  assert(csv.content.includes("'=1+1"));

  const pref = await json("/workspace/preferences", alice);
  cleanup.push(() =>
    json("/workspace/preferences", alice, "PATCH", {
      instructions: pref.instructions,
    }),
  );
  await json("/workspace/preferences", alice, "PATCH", {
    instructions: "Reply concisely in Thai.",
  });
  const memory = await json("/workspace/memories", alice, "POST", {
    content: "Preferred language: Thai",
    enabled: true,
  });
  cleanup.push(() => json(`/workspace/memories/${memory.id}`, alice, "DELETE"));
  await json(
    `/workspace/memories/${memory.id}`,
    bob,
    "PATCH",
    { content: "wrong", enabled: true },
    404,
  );

  const template = await json("/admin/workspace/templates", admin, "POST", {
    name: tag,
    description: "smoke test",
    systemPrompt: "Cite supplied references.",
    allowedModels: ["local-mock"],
    allowedRoles: ["ADMIN"],
    temperature: 0.2,
    maxOutputTokens: 128,
    enabled: true,
  });
  cleanup.push(() =>
    json(`/admin/workspace/templates/${template.id}`, admin, "PATCH", {
      name: tag,
      description: "completed smoke test",
      systemPrompt: "Cite supplied references.",
      allowedModels: ["local-mock"],
      allowedRoles: ["ADMIN"],
      temperature: 0.2,
      maxOutputTokens: 128,
      enabled: false,
    }),
  );
  assert(
    !(await json("/workspace/templates", alice)).some(
      (t) => t.id === template.id,
    ),
  );
  const toolConversation = await json("/conversations", alice, "POST", {
    title: `${tag}-tool`,
    projectId: project.id,
  });
  cleanup.push(() =>
    request(`/conversations/${toolConversation.id}`, alice.token, {
      method: "DELETE",
    }),
  );
  const toolChat = await json(
    `/conversations/${toolConversation.id}/tools`,
    alice,
    "POST",
    { tool: "search", input: "leave allowance" },
  );
  assert.equal(toolChat.messages.length, 2);
  assert.equal(toolChat.messages[0].metadata.tool, "search");
  assert.equal(toolChat.messages[1].citations[0].filename, "handbook.txt");
  assert.equal(toolChat.messages[1].usage, undefined);
  const toolFork = await json(
    `/conversations/${toolConversation.id}/branch`,
    alice,
    "POST",
    { messageId: toolChat.messages[1].id },
  );
  cleanup.push(() =>
    request(`/conversations/${toolFork.id}`, alice.token, {
      method: "DELETE",
    }),
  );
  assert.equal(toolFork.messages[0].metadata.tool, "search");
  assert.equal(toolFork.messages[1].metadata.tool, "search");
  await json(
    `/conversations/${toolConversation.id}/tools`,
    bob,
    "POST",
    { tool: "time" },
    404,
  );
  const conversation = await json("/conversations", alice, "POST", {
    title: tag,
    projectId: project.id,
  });
  cleanup.push(() =>
    request(`/conversations/${conversation.id}`, alice.token, {
      method: "DELETE",
    }),
  );
  assert.equal(
    (await chat(alice, conversation.id, "leave", { templateId: template.id }))
      .status,
    403,
  );
  const result = await chat(
    alice,
    conversation.id,
    "What is the annual leave allowance?",
  );
  assert.equal(result.status, 200, result.body);
  assert(result.body.includes("event: done"), result.body);
  const saved = await json(`/conversations/${conversation.id}`, alice);
  const answer = saved.messages.at(-1);
  assert.equal(answer.citations[0].filename, "handbook.txt");
  assert(answer.usage);
  assert.equal(answer.usage.usageKind, "SYNTHETIC");
  await json(
    `/conversations/${conversation.id}/messages/${answer.id}/feedback`,
    alice,
    "POST",
    { rating: 1, comment: "Useful demo" },
  );
  await json(
    `/conversations/${conversation.id}/messages/${answer.id}/feedback`,
    bob,
    "POST",
    { rating: -1 },
    404,
  );
  const fork = await json(
    `/conversations/${conversation.id}/branch`,
    alice,
    "POST",
    { messageId: saved.messages[0].id, before: true },
  );
  cleanup.push(() =>
    request(`/conversations/${fork.id}`, alice.token, { method: "DELETE" }),
  );
  assert.equal(fork.messages.length, 0);
  assert.equal(
    (await chat(alice, fork.id, "Revised question about leave")).status,
    200,
  );
  await json(`/conversations/${conversation.id}`, alice, "PATCH", {
    pinned: true,
    archived: true,
  });
  assert(
    !(await json("/conversations", alice)).some(
      (c) => c.id === conversation.id,
    ),
  );
  assert(
    (await json("/conversations?archived=true&search=allowance", alice)).some(
      (c) => c.id === conversation.id,
    ),
  );
  assert(
    !(await json("/conversations?archived=true&search=allowance", bob)).some(
      (c) => c.id === conversation.id,
    ),
  );

  assert.equal((await request("/admin/workspace", alice.token)).status, 403);
  const dashboard = await json("/admin/workspace", admin);
  assert(
    dashboard.feedback.some(
      (f) => f.modelId === "local-mock" && f.feedback === 1,
    ),
  );
  assert(
    !JSON.stringify(dashboard).includes("Annual leave allowance is 18 days"),
  );
  const user = dashboard.users.find((u) => u.username === "employee1");
  assert(user);
  const existing = dashboard.policies.find(
    (p) => p.scope === "USER" && p.subject === user.id,
  );
  const quota = await json("/admin/workspace/quotas", admin, "POST", {
    scope: "USER",
    subject: user.id,
    dailyRequests: 0,
  });
  cleanup.push(async () =>
    existing
      ? json("/admin/workspace/quotas", admin, "POST", {
          scope: existing.scope,
          subject: existing.subject,
          dailyRequests: existing.dailyRequests,
          dailyTokens: existing.dailyTokens,
          perRequestTokens: existing.perRequestTokens,
          dailySimulatedBudget:
            existing.dailySimulatedBudget === null
              ? null
              : Number(existing.dailySimulatedBudget),
        })
      : json(`/admin/workspace/quotas/${quota.id}`, admin, "DELETE"),
  );
  const blocked = await chat(alice, conversation.id, "This must not generate");
  assert.equal(blocked.status, 429, blocked.body);
  assert.equal(
    (await json(`/conversations/${conversation.id}`, alice)).messages.length,
    2,
  );
  const exported = await json("/workspace/usage.csv", alice);
  assert(exported.content.includes("local-mock"));
  assert(!exported.content.includes("Annual leave allowance"));
  console.log(
    JSON.stringify(
      {
        projects: "passed",
        ownership: "passed",
        documentRetrieval: "passed",
        thaiSearch: "passed",
        localTools: "passed",
        memories: "passed",
        templatePermissions: "passed",
        citationsAndUsage: "passed",
        branching: "passed",
        archiveAndFullTextSearch: "passed",
        feedbackAnalytics: "passed",
        quotas: "passed",
        csvExport: "passed",
        provider: "local-mock only",
      },
      null,
      2,
    ),
  );
} finally {
  for (const clean of cleanup.reverse()) {
    try {
      await clean();
    } catch (error) {
      console.error("Test cleanup failed:", error.message);
    }
  }
}
