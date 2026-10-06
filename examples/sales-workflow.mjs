import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, projectContext } from "../dist/index.js";
import { JsonStore } from "../dist/json-store.js";

// Standalone example based on the current proactive sales-playbook seed.
// This standalone example relies on the host to supply accepted facts.
const salesPlaybook = {
  name: "闲鱼·主动推送",
  platform: "xianyu",
  mode: "proactive",
  initialStage: "首发触达",
  stages: [
    {
      name: "首发触达",
      positioning: "把第一条合作邀约送到商家面前",
      subtasks: [
        {
          task: "核对触达资格",
          note: "未被拒绝过、不是全自动店铺，符合首发筛选条件",
        },
        { task: "选取首发话术", note: "从话术库选素材，结合对方商品情况微调" },
        { task: "发送并记录出处", note: "发出首发内容，记下用了哪些话术条目" },
      ],
      transitions: [
        {
          when: "对方回了一条真人消息",
          enter: "响应甄别",
          condition: {
            all: [{ field: "pb_human_replied", op: "eq", value: true }],
          },
        },
        {
          eventType: "timeout",
          when: "发出后72小时没有任何回应",
          enter: "沉默",
          condition: {
            all: [
              { field: "ctx_hours_since_last_out", op: "gte", value: 72 },
              { field: "ctx_inbound_since_last_out", op: "eq", value: false },
            ],
          },
        },
      ],
    },
    {
      name: "响应甄别",
      positioning: "判断对方是谁、什么态度，决定走哪条路",
      subtasks: [
        {
          task: "判断消息来源",
          note: "真人 / 店铺自动回复 / 平台卡片；自动回复不算真实回应",
        },
        {
          task: "识别拒绝态度",
          note: "明确说不需要、不做代卖、勿扰等，视为拒绝",
        },
        {
          task: "提取对方关切",
          note: "找出对方最关心的：价格、产品，还是合作方式",
        },
      ],
      transitions: [
        {
          when: "对方是真人且开始提问",
          enter: "需求咨询",
          condition: {
            all: [
              { field: "pb_is_human", op: "eq", value: true },
              { field: "pb_is_asking", op: "eq", value: true },
            ],
          },
        },
        {
          when: "对方明确拒绝",
          enter: "已拒绝",
          condition: {
            all: [{ field: "pb_explicit_refusal", op: "eq", value: true }],
          },
        },
        {
          when: "对方引导转到微信等站外渠道",
          enter: "已转微信",
          condition: {
            all: [{ field: "pb_wechat_redirect", op: "eq", value: true }],
          },
        },
        {
          when: "对方只是自动回复或平台卡片",
          enter: "响应甄别",
          condition: {
            all: [{ field: "pb_is_auto_reply", op: "eq", value: true }],
          },
        },
      ],
    },
    {
      name: "需求咨询",
      positioning: "认真回答对方关于产品和合作的每一个问题",
      subtasks: [
        {
          task: "解答产品与政策问题",
          note: "控价、试用、书目、售后等，优先引用话术库条目并注明出处",
        },
        {
          task: "引导体验",
          note: "给出体验路径：搜索小程序、免费课程、宣传资料",
        },
        {
          task: "沉淀需求信息",
          note: "对方想要的品类（如 RAZ、海尼曼）记入需求心愿单",
        },
      ],
      transitions: [
        {
          when: "对方开始谈价格、折扣或利润",
          enter: "意向深化",
          condition: {
            all: [{ field: "pb_price_discussed", op: "eq", value: true }],
          },
        },
        {
          when: "对方明确拒绝",
          enter: "已拒绝",
          condition: {
            all: [{ field: "pb_explicit_refusal", op: "eq", value: true }],
          },
        },
        {
          when: "两次回避实质问题",
          enter: "已拒绝",
          condition: {
            all: [{ field: "pb_evasion_count", op: "gte", value: 2 }],
          },
        },
        {
          when: "对方引导转到微信等站外渠道",
          enter: "已转微信",
          condition: {
            all: [{ field: "pb_wechat_redirect", op: "eq", value: true }],
          },
        },
        {
          eventType: "timeout",
          when: "我方答复完最后一问后对方48小时未再回复",
          enter: "沉默",
          condition: {
            all: [
              { field: "ctx_hours_since_last_out", op: "gte", value: 48 },
              { field: "ctx_inbound_since_last_out", op: "eq", value: false },
            ],
          },
        },
      ],
      stallExit: { rounds: 4, enter: "沉默" },
    },
    {
      name: "意向深化",
      positioning: "把合作意向变成具体的合作动作",
      subtasks: [
        {
          task: "讲清合作方式",
          note: "拿码分销、卖价自定赚差价、不囤货不发货、售后全包",
        },
        { task: "化解顾虑", note: "用话术库「异议处理」条目回应，不越权承诺" },
        {
          task: "推进下一步",
          note: "每次回复都带一个明确动作：去体验、反馈感受、上架挂码",
        },
      ],
      transitions: [
        {
          when: "对方同意合作",
          enter: "准备成交",
          condition: { all: [{ field: "pb_agreed", op: "eq", value: true }] },
        },
        {
          when: "询问上架、拿码细节",
          enter: "准备成交",
          condition: {
            all: [{ field: "pb_asks_listing_details", op: "eq", value: true }],
          },
        },
        {
          when: "顾虑化解不了且对方明确拒绝",
          enter: "已拒绝",
          condition: {
            all: [{ field: "pb_explicit_refusal", op: "eq", value: true }],
          },
        },
        {
          when: "对方引导转到微信等站外渠道",
          enter: "已转微信",
          condition: {
            all: [{ field: "pb_wechat_redirect", op: "eq", value: true }],
          },
        },
      ],
    },
    {
      name: "准备成交",
      positioning: "收尾交接，把商家人工移交给运营",
      subtasks: [
        {
          task: "输出交接摘要",
          note: "整理会话经过、商家画像、谈定条件，推送给运营",
        },
        { task: "停止自动回复", note: "移交后不再以 AI 身份答复该商家" },
      ],
      transitions: [{ when: "运营接管完成", enter: "已拒绝", manual: true }],
    },
    {
      name: "已转微信",
      terminal: "可复活",
      positioning:
        "沟通已转移到微信等站外渠道，站内拿不到后续数据，流程到此收口，由运营在微信跟进",
      subtasks: [
        {
          task: "记录站外联系方式",
          note: "把对方给出的微信 ID / 暗号原话记入阶段判定依据，供运营接手",
        },
        {
          task: "停止站内自动跟进",
          note: "不再向该商家发送站内自动消息，避免站内外重复打扰",
        },
      ],
      transitions: [
        { when: "无出口（对方回到站内由运营处理）", enter: "已转微信" },
      ],
    },
    {
      name: "沉默",
      terminal: "可复活",
      positioning: "对方一直没回；回访拿到真人回应即可回来",
      subtasks: [
        {
          task: "按回访计划低频跟进",
          note: "默认7天一次、最多2次；换个角度说，不重复原话术",
        },
      ],
      transitions: [
        {
          when: "回访获得真人回应",
          enter: "响应甄别",
          condition: {
            all: [{ field: "pb_human_replied", op: "eq", value: true }],
          },
        },
      ],
    },
    {
      name: "已拒绝",
      terminal: true,
      positioning: "明确拒绝或全自动店铺，此后不再进入任何触达队列",
      subtasks: [
        {
          task: "记录拒绝原因",
          note: "把原因和对方原话记下来，供策略复盘使用",
        },
      ],
      transitions: [{ when: "无出口（人工解禁除外）", enter: "已拒绝" }],
    },
  ],
};

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function equals(actual, expected) {
  if (typeof actual === "number" || typeof expected === "number") {
    const a = toNumber(actual);
    const b = toNumber(expected);
    return a !== null && b !== null && a === b;
  }
  return actual === expected;
}

function matches(actual, item) {
  if (actual === undefined || actual === null) return false;
  switch (item.op) {
    case "exists":
      return true;
    case "eq":
      return item.value !== undefined && equals(actual, item.value);
    case "ne":
      return item.value !== undefined && !equals(actual, item.value);
    case "gte": {
      const value = toNumber(actual);
      return (
        value !== null &&
        item.value !== undefined &&
        value >= Number(item.value)
      );
    }
    case "lte": {
      const value = toNumber(actual);
      return (
        value !== null &&
        item.value !== undefined &&
        value <= Number(item.value)
      );
    }
    case "in":
      return (
        Array.isArray(item.value) &&
        item.value.some((value) => equals(actual, value))
      );
    default:
      return false;
  }
}

const plugin = {
  id: "sales-workflow-example",
  version: "1",
  guards: {
    condition: ({ event, params }) => {
      const all = params.condition.all;
      const pass =
        event.type === params.eventType &&
        all.every((item) => matches(event.facts[item.field], item));
      return { pass, reason: params.when };
    },
    manual: ({ event, params }) => ({
      pass:
        event.type === "operator" &&
        event.facts.action === params.when &&
        event.facts.operatorApproved === true,
      reason: params.when + "（宿主已核验运营权限）",
    }),
    stallExit: ({ event, instance, params }) => ({
      pass:
        event.type === "analysis" &&
        instance.data.analyzeCount >= params.rounds,
      reason: "本阶段连续 " + params.rounds + " 次分析无流转",
    }),
  },
  onEvent: ({ event, instance }) => ({
    ...instance.data,
    analyzeCount:
      (instance.data.analyzeCount ?? 0) + (event.type === "analysis" ? 1 : 0),
  }),
  onTransition: ({ instance }) => ({
    ...instance.data,
    analyzeCount: 0,
  }),
  context: ({ definition, instance }) => {
    const stage = salesPlaybook.stages.find(
      (item) => item.name === instance.nodeId,
    );
    return {
      stageName: stage.name,
      positioning: stage.positioning,
      subtasks: stage.subtasks,
      transitions: stage.transitions
        .filter((rule) => rule.condition && rule.manual !== true)
        .map(({ when, enter, condition }) => ({ when, enter, condition })),
      terminal:
        stage.terminal === true
          ? "absolute"
          : stage.terminal
            ? "reopenable"
            : null,
      playbookVersion: definition.version,
      analyzeCount: instance.data.analyzeCount ?? 0,
    };
  },
};

// Preserve transition array order: it is the source playbook's rule priority.
// Manual rules become operator-event edges; the host must authorize their caller.
const definition = {
  id: "xianyu-proactive-sales",
  version: "seed-2026-10-04",
  plugin: { id: plugin.id, version: plugin.version },
  initial: salesPlaybook.initialStage,
  cascade: true,
  nodes: salesPlaybook.stages.map((stage) => ({
    id: stage.name,
    label: stage.name,
    // Only boolean true is an absolute final state. "可复活" stages can have exits.
    ...(stage.terminal === true ? { terminal: true } : {}),
  })),
  edges: [
    ...salesPlaybook.stages.flatMap((stage, stageIndex) => {
      const rules = stage.transitions.flatMap((rule, ruleIndex) => {
        if (!rule.condition && rule.manual !== true) return [];
        return [
          {
            id: "stage-" + stageIndex + "-rule-" + ruleIndex,
            from: stage.name,
            to: rule.enter,
            guard: rule.manual ? "manual" : "condition",
            params: {
              when: rule.when,
              eventType: rule.eventType ?? "analysis",
              condition: rule.condition ?? null,
            },
          },
        ];
      });
      if (stage.stallExit) {
        rules.push({
          id: "stage-" + stageIndex + "-stall-exit",
          from: stage.name,
          to: stage.stallExit.enter,
          guard: "stallExit",
          params: { rounds: stage.stallExit.rounds },
        });
      }
      return rules;
    }),
    // Adapter-only policy: the operator handles an on-site return
    // but does not specify a destination rule in the playbook itself.
    {
      id: "host-manual-reopen-from-wechat",
      from: "已转微信",
      to: "响应甄别",
      guard: "manual",
      params: {
        when: "运营确认商家回到站内",
        condition: null,
      },
    },
  ],
};

const registry = createRegistry([plugin]);
const startedAt = "2026-10-01T00:00:00.000Z";

function acceptedAnalysisEvent(id, observedAt, entries) {
  // A real host validates task identity, allowed fields, values, evidence and message watermark first.
  const facts = {};
  const evidence = [];
  for (const entry of entries) {
    assert.equal(
      Object.hasOwn(facts, entry.key),
      false,
      "duplicate field: " + entry.key,
    );
    facts[entry.key] = entry.value;
    if (entry.value !== null) {
      assert.ok(
        entry.evidence?.length,
        "non-null fact requires evidence: " + entry.key,
      );
      evidence.push(...entry.evidence);
    }
  }
  return { id, type: "analysis", observedAt, facts, evidence };
}

async function createStore(dir, file, conversationId) {
  const store = new JsonStore(join(dir, file), registry);
  await store.init(definition, conversationId, startedAt, { analyzeCount: 0 });
  return store;
}

async function dispatch(store, event, label) {
  const before = await store.read();
  const result = await store.dispatch({
    expectedRevision: before.instance.revision,
    event,
    now: event.observedAt,
  });
  const agentContext = projectContext(definition, result.instance, registry);
  const output = {
    label,
    stageFrom: before.instance.nodeId,
    stageTo: result.instance.nodeId,
    transitions: result.transitions.map(({ from, to, reason }) => ({
      from,
      to,
      reason,
    })),
    revision: result.instance.revision,
    contextForNextAgentTask: {
      stageName: agentContext.stageName,
      positioning: agentContext.positioning,
      tasks: agentContext.subtasks.map(({ task }) => task),
      availableTransitions: agentContext.transitions.map(({ when, enter }) => ({
        when,
        enter,
      })),
    },
  };
  console.log(JSON.stringify(output));
  return result;
}

const dir = await mkdtemp(join(tmpdir(), "agent-stage-kit-sales-"));
try {
  const normal = await createStore(dir, "normal.json", "conversation-normal");
  const firstReport = acceptedAnalysisEvent(
    "normal-analysis-1",
    "2026-10-01T01:00:00Z",
    [
      {
        key: "pb_human_replied",
        value: true,
        evidence: [{ type: "message", ref: "msg-101", quote: "真人回复示例" }],
      },
      {
        key: "pb_is_human",
        value: true,
        evidence: [{ type: "message", ref: "msg-101", quote: "真人回复示例" }],
      },
      {
        key: "pb_is_asking",
        value: true,
        evidence: [
          { type: "message", ref: "msg-102", quote: "想了解合作方式" },
        ],
      },
    ],
  );
  const toConsultation = await dispatch(
    normal,
    firstReport,
    "真人回复并提问：两跳级联",
  );
  assert.equal(toConsultation.instance.nodeId, "需求咨询");
  assert.deepEqual(
    toConsultation.transitions.map(({ from, to }) => [from, to]),
    [
      ["首发触达", "响应甄别"],
      ["响应甄别", "需求咨询"],
    ],
  );

  const toIntent = await dispatch(
    normal,
    acceptedAnalysisEvent("normal-analysis-2", "2026-10-01T02:00:00Z", [
      {
        key: "pb_price_discussed",
        value: true,
        evidence: [
          { type: "message", ref: "msg-103", quote: "价格和利润怎么计算？" },
        ],
      },
    ]),
    "进入意向深化",
  );
  assert.equal(toIntent.instance.nodeId, "意向深化");

  const toClosing = await dispatch(
    normal,
    acceptedAnalysisEvent("normal-analysis-3", "2026-10-01T03:00:00Z", [
      {
        key: "pb_agreed",
        value: true,
        evidence: [
          { type: "message", ref: "msg-104", quote: "可以，按这个方式合作" },
        ],
      },
    ]),
    "进入准备成交",
  );
  assert.equal(toClosing.instance.nodeId, "准备成交");

  // In production this event is constructed only after the operator endpoint checks identity and permission.
  const operatorResult = await dispatch(
    normal,
    {
      id: "normal-operator-1",
      type: "operator",
      observedAt: "2026-10-01T04:00:00Z",
      facts: { action: "运营接管完成", operatorApproved: true },
      evidence: [{ type: "operator-audit", ref: "audit-201" }],
    },
    "运营完成接管",
  );
  assert.equal(operatorResult.instance.nodeId, "已拒绝");

  const wechatReturn = await createStore(
    dir,
    "wechat-return.json",
    "conversation-wechat-return",
  );
  const redirected = await dispatch(
    wechatReturn,
    acceptedAnalysisEvent("wechat-analysis-1", "2026-10-01T01:00:00Z", [
      {
        key: "pb_human_replied",
        value: true,
        evidence: [{ type: "message", ref: "msg-401" }],
      },
      {
        key: "pb_wechat_redirect",
        value: true,
        evidence: [{ type: "message", ref: "msg-402" }],
      },
    ]),
    "商家给出站外联系方式",
  );
  assert.equal(redirected.instance.nodeId, "已转微信");
  const reopened = await dispatch(
    wechatReturn,
    {
      id: "wechat-operator-1",
      type: "operator",
      observedAt: "2026-10-01T02:00:00Z",
      facts: {
        action: "运营确认商家回到站内",
        operatorApproved: true,
      },
      evidence: [{ type: "operator-audit", ref: "audit-402" }],
    },
    "适配器扩展：运营确认后重新进入响应甄别",
  );
  assert.equal(reopened.instance.nodeId, "响应甄别");

  const timeout = await createStore(
    dir,
    "timeout.json",
    "conversation-timeout",
  );
  const timedOut = await dispatch(
    timeout,
    {
      id: "timeout-scan-1",
      type: "timeout",
      observedAt: "2026-10-04T00:00:00Z",
      facts: {
        ctx_hours_since_last_out: 72,
        ctx_inbound_since_last_out: false,
      },
    },
    "宿主超时扫描：首发后72小时无回应",
  );
  assert.equal(timedOut.instance.nodeId, "沉默");

  const stalled = await createStore(dir, "stall.json", "conversation-stall");
  const stallStart = await dispatch(
    stalled,
    acceptedAnalysisEvent("stall-entry-1", "2026-10-01T01:00:00Z", [
      {
        key: "pb_human_replied",
        value: true,
        evidence: [{ type: "message", ref: "msg-301" }],
      },
      {
        key: "pb_is_human",
        value: true,
        evidence: [{ type: "message", ref: "msg-301" }],
      },
      {
        key: "pb_is_asking",
        value: true,
        evidence: [{ type: "message", ref: "msg-302" }],
      },
    ]),
    "停滞演示：先进入需求咨询",
  );
  assert.equal(stallStart.instance.nodeId, "需求咨询");

  for (let round = 1; round <= 4; round += 1) {
    const result = await dispatch(
      stalled,
      acceptedAnalysisEvent(
        "stall-analysis-" + round,
        "2026-10-01T0" + (round + 1) + ":00:00Z",
        [
          {
            key: "pb_price_discussed",
            value: null,
          },
          {
            key: "pb_explicit_refusal",
            value: null,
          },
          {
            key: "pb_evasion_count",
            value: null,
          },
          {
            key: "pb_wechat_redirect",
            value: null,
          },
        ],
      ),
      "需求咨询无流转，第 " + round + " 次分析",
    );
    assert.equal(result.instance.nodeId, round === 4 ? "沉默" : "需求咨询");
  }

  console.log(
    "已验证：分析级联、阶段上下文、JSON 检查点、宿主超时、4 次停滞出口和人工事件。",
  );
  console.log("演示事实为模拟输入；没有连接 Agent、消息平台或业务数据库。");
} finally {
  await rm(dir, { recursive: true, force: true });
}
