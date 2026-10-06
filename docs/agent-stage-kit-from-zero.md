# 从最小例子理解 agent-stage-kit

如果只记一句话：agent-stage-kit 接收“当前在哪一步”和“刚刚确认了什么”，按规则算出下一步；它不负责让 Agent 做事，也不替宿主判断事实真假。

可以把它想成一个路口裁判：

    当前阶段 + 已核验的事件 → 下一阶段 + 一条可审计的转移记录

## 先看最小流程：调研 → 编写 → 完成

项目里的 examples/linear.mjs 就是最小例子。假设 Agent 接到“完成一篇文章”的工作：

    调研 -- 调研已确认 --> 编写 -- 草稿已确认 --> 完成

这张图里只有四个东西：

| 代码概念 | 在这个例子里是什么                                      |
| -------- | ------------------------------------------------------- |
| Node     | 一步工作：调研、编写、完成                              |
| Edge     | 允许从调研走到编写，或从编写走到完成                    |
| Event    | 宿主提交的一次结果，例如“调研检查完成”                  |
| Guard    | Edge 上的通行条件，例如“事件类型对，而且 ready 是 true” |

示例把规则写成：

    nodes: [
      { id: "research", label: "调研" },
      { id: "write", label: "编写" },
      { id: "done", label: "完成", terminal: true }
    ]

    edges: [
      {
        from: "research",
        to: "write",
        guard: "ready",
        params: "research"
      },
      {
        from: "write",
        to: "done",
        guard: "ready",
        params: "write"
      }
    ]

ready guard 的核心判断是：

    event.type === params && event.facts.ready === true

所以：

    当前阶段 research
    收到 { type: "research", facts: { ready: false } }
    结果：还在 research

而：

    当前阶段 research
    收到 { type: "research", facts: { ready: true } }
    结果：转到 write

这不是 kit 读了调研报告后认定 ready。示例里 ready 是调用方给的输入；真实宿主必须先检查 Agent 的产物，再提交可信的 ready 值。Guard 只回答“给我的事实是否满足规则”。

## 一次调用到底发生什么

调用方持有一个 Instance。它表示这项工作当前停在哪个 Node，例如：

    {
      "id": "article-123",
      "nodeId": "research",
      "revision": 0
    }

宿主把当前阶段的工作说明交给 Agent。Agent 做完调研后，宿主验收结果，再交一个 Event 给 kit：

    {
      "id": "research-report-1",
      "type": "research",
      "facts": { "ready": true }
    }

宿主调用 advance(definition, instance, event, registry, now)。结果大致是：

    {
      "instance": { "nodeId": "write", "revision": 1 },
      "transitions": [
        { "from": "research", "to": "write" }
      ],
      "decisions": [
        { "pass": true, "reason": "产物已确认" }
      ]
    }

    宿主保存新 Instance 和转换记录，然后决定要不要创建下一项 Agent 工作。下一次给 Agent 的说明就来自 write 阶段。advance 不会自行启动 Agent、自动重试或发起下一项任务。这个最小例子只调用纯函数，所以也没有数据库；需要本地保存时，kit 另有 JsonStore。

## 字段名由谁解释

Event.facts 是普通 JSON 对象。内核不因为字段叫 ready、pb_human_replied、ctx_hours_since_last_out 或其他名字而赋予它特殊含义；只检查事件整体是合法 JSON，再把事件交给当前业务 Plugin 的 guard。Plugin 可以检查它需要的键，也可以由宿主在提交事件前校验固定字段、类型、来源和证据。

例如通用流程只看 ready：

    facts: { ready: true }

销售业务可能看 pb_human_replied，另一个业务可以用 humanReplied 或 conversation.human_replied。字段命名、前缀、哪些字段能触发哪些规则，都是业务契约；agent-stage-kit 不内置 pb_ 或 ctx_ 规则。若还要表达“谁生成了字段”，请用来源元数据或事件来源表达，不要从字段名前缀猜。

因此“固定字段门禁”是由业务字段契约、宿主校验和 Plugin guard 一起组成的；内核统一处理事件和状态转移。

因此，四步责任是：

    宿主告诉 Agent 当前任务
    Agent 执行并报告结果
    宿主核验结果并形成 Event
    agent-stage-kit 按规则更新阶段

## 这套代码解决的具体问题

Agent 负责理解和执行开放式任务，宿主负责真实世界的权限、证据与副作用。两者之间需要一个明确的流程控制点来回答：

- 现在处于哪个阶段？
- 哪些结果允许离开当前阶段？
- 失败时留在原地、转去返工，还是结束？
- 如果一次结果已满足连续几步的条件，是否可以级联推进？
- 这次为什么转移，依据哪个事件，定义版本是什么？

agent-stage-kit 把这些判断集中到一份状态图和 Plugin guard 中，并返回 Instance、decisions 和 transitions。这样 Agent 不必自己声明“我现在进入下一阶段”，宿主也不必在多个 service 分支里重复写状态判断。

## 再映射到三个常见场景

共同抽象可以写成：

    一项工作 + 当前阶段 + 已确认事件 → 阶段转移

但三个上层场景的工作内容和节奏不同：

| 场景       | 一项工作是什么         | 状态图里可以放什么                                       | Event 从哪里来                                |
| ---------- | ---------------------- | -------------------------------------------------------- | --------------------------------------------- |
| 页面设计   | 一次设计任务或页面改造 | 理解需求、形成设计方向、生成页面、检查效果、返工/交付    | Agent 产物、预览检查结果、人工评审结论        |
| 商家沟通   | 一个商家会话           | 首发触达、响应甄别、需求咨询、意向深化、准备成交、沉默等 | Agent 分析字段、宿主计算的超时、运营操作      |
| UI 改进    | 一次界面设计或改进任务 | 选定的设计步骤或质量门，例如规划、实现、审查、修正       | Agent 工作结果、浏览器/检查工具结果、人工确认 |

这三种场景都要判断“Agent 做完当前一步后，流程该不该进入下一步、回到前一步，还是结束”。agent-stage-kit 可以承接这个共同的阶段判定层。

这里说的是相同的函数结构，不代表不同业务目前有相同的状态机、状态名称或代码。设计工作流可以把理解、方案、制作、审查和修正作为任务入口；上层指令负责指导 Agent 执行，agent-stage-kit 可以表达这些任务之间的状态和转移，但不会自动执行设计命令。

需要把范围说窄一点：它不是页面设计、商家沟通或 UI 工作流的整体替代品。它不会生成设计、调用浏览器、运行销售对话、检查页面截图或选择要执行的技能。接入方仍要把各自的阶段规则写成 Definition/Plugin，并由宿主把执行结果转换成 Event。

粗略分工如下：

    页面设计 / UI 改进 / 商家沟通业务
      提供各自的任务、Agent 指令、工具和领域规则
                 ↓ 适配
    agent-stage-kit
      持有当前阶段，按已核验事件选择下一阶段并记录理由
                 ↓ 结果
    宿主
      保存状态、创建后续任务、执行发送/浏览器/审核等外部动作

只有当阶段状态或转移需要被明确表达、测试和审计时，共用这个底层才有价值。如果只是一次性提示词串联，没有持久阶段、条件分支或转移记录，直接用 Agent skill/普通代码会更轻。

## 销售示例里的字段名

销售示例沿用业务字段键，例如 `pb_human_replied` 和 `ctx_hours_since_last_out`。这些名字只是业务数据契约中的键；agent-stage-kit 不会从 `pb_`、`ctx_` 或其他前缀推断字段能否被引用、由谁生成、谁有权提交。

这些区别由接入业务表达：字段定义说明字段含义、类型和允许的生产方；宿主验收提交者和证据；业务 Plugin 的规则决定哪些字段组合可以通过门禁。事件类型也可由业务显式区分，例如 Agent 分析事件 `analysis`、超时扫描事件 `timeout`。同一个 `facts` 对象里的字段在框架层一视同仁。

如果把业务字段改名，需要同步更新该业务自己的定义、规则和调用方；这不是框架的要求。其他接入方可以直接使用 `ready`、`humanReplied`、`conversation.human_replied` 或自己的任意 JSON 键。

## 建议阅读顺序

1. 先运行 npm run demo:linear，看两条 ready 事件如何改变阶段。
2. 再看 examples/routing.mjs，理解分支、优先级、级联、超时和阶段计数。
3. 最后看[销售流程完整示例](sales-workflow-with-agent-stage-kit.md)，把简单的 ready 条件换成真实的会话分析字段。

完整最小例子见 [examples/linear.mjs](../examples/linear.mjs)；API 和持久化边界见 [README](../README.md)。
