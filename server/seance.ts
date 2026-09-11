import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PaseoAgentTimelineEvent, PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { seanceBind, seanceStatus, seanceUnbind, type SeanceBinding } from "../shared/seance";

type PaseoApi = PluginHandlerContext["paseo"];

// lark SDK 是 CJS 且顶层层引用 __dirname，静态 import 会让 ESM 打包在加载期炸掉，
// 所以走 createRequire 在真正配置了飞书时才惰性加载。
type LarkModule = typeof import("@larksuiteoapi/node-sdk");
let Lark: LarkModule | null = null;
function loadLark(pluginDir: string): LarkModule {
  if (!Lark) {
    // 插件子进程 cwd 是 "/"、env 里没有插件目录，import.meta.url 也被打包器抹掉，
    // 只能靠配置里的 pluginDir 定位插件的 node_modules
    const require = createRequire(join(pluginDir, "package.json"));
    Lark = require("@larksuiteoapi/node-sdk") as LarkModule;
  }
  return Lark;
}

interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** 出站消息发到这个会话（私聊机器人时就是与机器人的会话 id） */
  chatId: string;
  /** 只接受这些 chat_id 的入站消息；缺省时只接受 chatId 本身 */
  allowedChatIds?: string[];
  /** 插件源码目录的绝对路径，用于加载 lark SDK */
  pluginDir: string;
}

// 配置默认放 ~/.paseo/feishu-seance.config.json（插件子进程 cwd 是 "/"，不能用相对路径），
// 旧名 feishu-relay.config.json 兜底兼容；也可用 FEISHU_SEANCE_CONFIG 指到别处。
// 没有配置时进入 dry-run：出站消息只写插件日志，入站长连接不启动。
const dataDir = join(homedir(), ".paseo");
const legacyConfigPath = join(dataDir, "feishu-relay.config.json");
const configPath =
  process.env.FEISHU_SEANCE_CONFIG ??
  (existsSync(join(dataDir, "feishu-seance.config.json"))
    ? join(dataDir, "feishu-seance.config.json")
    : legacyConfigPath);
const statePath = join(dirname(configPath), "feishu-seance.state.json");

let config: FeishuConfig | null = null;
type LarkClient = InstanceType<LarkModule["Client"]>;
type LarkWSClient = InstanceType<LarkModule["WSClient"]>;
let larkClient: LarkClient | null = null;
let wsClient: LarkWSClient | null = null;
let paseoApi: PaseoApi | null = null;
let binding: SeanceBinding | null = null;
let unsubscribeTimeline: (() => void) | null = null;
let unsubscribeDirectory: (() => void) | null = null;
let directoryWatchStarted = false;
let forwardedTurns = 0;

// 一个 turn 内 assistant_message 可能增量推送，按 messageId 聚合，turn 结束时一次性发出
let turnTexts = new Map<string, string>();
let turnToolCalls = 0;

function log(...args: unknown[]) {
  console.log("[feishu-seance]", ...args);
}

function loadConfig(): FeishuConfig | null {
  try {
    if (!existsSync(configPath)) return null;
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    if (!raw.appId || !raw.appSecret || !raw.chatId || !raw.pluginDir) {
      log("config missing appId/appSecret/chatId/pluginDir, dry-run mode");
      return null;
    }
    return raw as FeishuConfig;
  } catch (error) {
    console.error("[feishu-seance] failed to read config:", error);
    return null;
  }
}

function loadState() {
  try {
    if (existsSync(statePath)) {
      const restored = JSON.parse(readFileSync(statePath, "utf8"));
      // 缺 workspaceId 的旧格式状态直接作废，让用户重绑一次
      binding = restored?.agentId && restored?.workspaceId ? restored : null;
      if (binding) log("restored binding:", binding);
    }
  } catch {
    binding = null;
  }
}

function saveState() {
  try {
    writeFileSync(statePath, JSON.stringify(binding));
  } catch (error) {
    console.error("[feishu-seance] failed to persist state:", error);
  }
}

async function sendToFeishu(text: string): Promise<void> {
  if (!larkClient || !config) {
    log("[dry-run] would send to feishu:", text.slice(0, 500));
    return;
  }
  try {
    // Card JSON 2.0 的 markdown 组件，支持面比 lark_md 宽得多（社区实现的事实标准）
    const card = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      body: { elements: [{ tag: "markdown", content: text }] },
    };
    await larkClient.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: config.chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
  } catch (error) {
    console.error("[feishu-seance] feishu send failed:", error);
  }
}

function onStreamEvent(stream: PaseoAgentTimelineEvent) {
  const event = stream.event;
  switch (event.type) {
    case "timeline": {
      const item = event.item;
      if (item.type === "assistant_message") {
        // 不同 provider 的增量推送语义不同：有的是 delta，有的是累计全文。
        // 启发式：新文本以旧文本为前缀则视为累计（覆盖），否则视为 delta（追加）。
        const key = item.messageId ?? "anon";
        const prev = turnTexts.get(key) ?? "";
        turnTexts.set(key, prev.length > 0 && item.text.startsWith(prev) ? item.text : prev + item.text);
      } else if (item.type === "tool_call" && (item.status === "completed" || item.status === "failed")) {
        turnToolCalls += 1;
      }
      break;
    }
    case "turn_completed": {
      const parts = [...turnTexts.values()].filter((t) => t.trim().length > 0);
      const toolNote = turnToolCalls > 0 ? `\n——（本轮 ${turnToolCalls} 次工具调用）` : "";
      turnTexts = new Map();
      turnToolCalls = 0;
      if (parts.length > 0) {
        forwardedTurns += 1;
        void sendToFeishu(parts.join("\n\n") + toolNote);
      }
      break;
    }
    case "permission_requested":
      void sendToFeishu(`⚠️ 有待批准：${event.request.title ?? event.request.name}，请回桌面处理`);
      break;
    case "turn_failed":
      void sendToFeishu(`❌ 本轮出错：${event.error}`);
      break;
  }
}

function boundAgentGone(update: PaseoAgentUpdate): boolean {
  if (!binding) return false;
  if (update.kind === "remove") return update.agentId === binding.agentId;
  return update.agent.id === binding.agentId && Boolean(update.agent.archivedAt);
}

function boundWorkspaceGone(update: PaseoWorkspaceUpdate): boolean {
  if (!binding) return false;
  if (update.kind === "remove") return update.id === binding.workspaceId;
  return update.workspace.id === binding.workspaceId && Boolean(update.workspace.archivingAt);
}

function releaseBinding(reason?: string): boolean {
  if (!binding) return false;
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  binding = null;
  saveState();
  disconnectFeishuWs();
  void sendToFeishu(reason ? `🕊️ 已归位：${reason}` : "🕊️ 已归位");
  return true;
}

function subscribeBoundAgent() {
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  if (!binding || !paseoApi) return;
  unsubscribeTimeline = paseoApi.agents.ref(binding.agentId).timeline.subscribe(onStreamEvent);
  log("subscribed timeline for agent", binding.agentId);
}

// agent_update / workspace_update 默认不推到会话，要先 list({ subscribe }) 打开目录流。
function ensureSession(paseo: PaseoApi) {
  paseoApi = paseo;
  if (!unsubscribeDirectory) {
    const unsubAgents = paseo.agents.subscribe((update: PaseoAgentUpdate) => {
      if (!boundAgentGone(update)) return;
      log("bound agent archived/removed, unbinding");
      releaseBinding("会话已关闭");
    });
    const unsubWorkspaces = paseo.workspaces.subscribe((update: PaseoWorkspaceUpdate) => {
      if (!boundWorkspaceGone(update)) return;
      log("bound workspace archiving/removed, unbinding");
      releaseBinding("会话已关闭");
    });
    unsubscribeDirectory = () => {
      unsubAgents();
      unsubWorkspaces();
    };
  }
  if (directoryWatchStarted) return;
  directoryWatchStarted = true;
  void Promise.all([
    paseo.agents.list({ subscribe: {}, scope: "active" }),
    paseo.workspaces.list({ subscribe: {} }),
  ])
    .then(() => {
      log("subscribed agent/workspace directories");
    })
    .catch((error) => {
      directoryWatchStarted = false;
      console.error("[feishu-seance] failed to subscribe directories:", error);
    });
}

async function dropBindingIfGone() {
  const current = binding;
  if (!current || !paseoApi) return;
  try {
    const result = await paseoApi.agents.ref(current.agentId).refresh();
    if (binding?.agentId !== current.agentId) return;
    if (!result?.agent || result.agent.archivedAt) {
      log("bound agent missing or archived on refresh, unbinding");
      releaseBinding("会话已关闭");
    }
  } catch (error) {
    if (binding?.agentId !== current.agentId) return;
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|archived|unknown agent|no such/i.test(message)) {
      log("bound agent refresh said gone, unbinding:", message);
      releaseBinding("会话已关闭");
    } else {
      log("bound agent refresh failed:", message);
    }
  }
}

// 下载飞书消息里的图片，连同文本一起发给绑定的 agent
async function forwardToAgent(text: string, imageKeys: string[], messageId: string) {
  if (!binding || !paseoApi || !larkClient) return;
  try {
    const images: Array<{ data: string; mimeType: string }> = [];
    for (const imageKey of imageKeys) {
      const res = await larkClient.im.messageResource.get({
        path: { message_id: messageId, file_key: imageKey },
        params: { type: "image" },
      });
      const tmp = join(tmpdir(), `feishu-seance-${messageId}-${imageKey}`);
      await res.writeFile(tmp);
      const buf = readFileSync(tmp);
      unlinkSync(tmp);
      const mimeType = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
      images.push({ data: buf.toString("base64"), mimeType });
    }
    const prompt = text || "（飞书发来图片）";
    await paseoApi.agents
      .ref(binding.agentId)
      .send(prompt, images.length > 0 ? { images } : undefined);
    await sendToFeishu(`✅ 已送达 ${binding.title ?? binding.agentId}${images.length > 0 ? `（含 ${images.length} 张图片）` : ""}`);
  } catch (error) {
    await sendToFeishu(`❌ 送达失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

// post（富文本）消息：段落 → 段内节点；抽出纯文本和内嵌图片 key。
// 引用别人的消息、图文混排都会被飞书转成 post，不走 text 类型。
function parsePostContent(content: string): { text: string; imageKeys: string[] } {
  const parsed = JSON.parse(content) as {
    title?: string;
    content?: Array<Array<{ tag: string; text?: string; image_key?: string }>>;
  };
  const texts: string[] = [];
  const imageKeys: string[] = [];
  if (parsed.title?.trim()) texts.push(parsed.title.trim());
  for (const para of parsed.content ?? []) {
    let line = "";
    for (const seg of para) {
      if (seg.tag === "text" || seg.tag === "a") line += seg.text ?? "";
      else if (seg.tag === "img" && seg.image_key) imageKeys.push(seg.image_key);
    }
    if (line.trim()) texts.push(line);
  }
  return { text: texts.join("\n").trim(), imageKeys };
}

async function onFeishuMessage(data: {
  sender?: { sender_id?: { open_id?: string } };
  message?: { chat_id?: string; content?: string; message_type?: string; message_id?: string };
}) {
  log("inbound event:", JSON.stringify(data.message ?? {}).slice(0, 300));
  try {
    const chatId = data.message?.chat_id;
    if (!chatId || !config) return;
    const allowed = config.allowedChatIds ?? [config.chatId];
    if (!allowed.includes(chatId)) {
      log("rejected message from non-whitelisted chat:", chatId);
      return;
    }
    const msgType = data.message?.message_type;
    const messageId = data.message?.message_id ?? "";
    const content = data.message?.content ?? "{}";
    let text = "";
    let imageKeys: string[] = [];
    try {
      if (msgType === "text") {
        text = JSON.parse(content).text?.trim() ?? "";
      } else if (msgType === "image") {
        imageKeys = [JSON.parse(content).image_key].filter(Boolean);
      } else if (msgType === "post") {
        ({ text, imageKeys } = parsePostContent(content));
      } else {
        log("unsupported message_type:", msgType);
        await sendToFeishu(`暂不支持的消息类型：${msgType}（目前支持文字、图片、图文混排）`);
        return;
      }
    } catch {
      log("failed to parse message content:", content.slice(0, 200));
      return;
    }
    if (text === "/status") {
      await sendToFeishu(
        binding ? `🔮 通灵中：${binding.title ?? binding.agentId}` : "尚未降灵。去桌面端 ⌘K 执行「通灵到飞书」",
      );
      return;
    }
    if (!text && imageKeys.length === 0) {
      log("empty message after parse, ignored");
      return;
    }
    if (!binding || !paseoApi) {
      await sendToFeishu("尚未降灵，消息未送达");
      return;
    }
    await forwardToAgent(text, imageKeys, messageId);
  } catch (error) {
    console.error("[feishu-seance] inbound handler crashed:", error);
  }
}

// REST 客户端只发消息、不收事件，一直挂着无害
function ensureLarkClient() {
  if (larkClient || !config) return;
  const LarkSdk = loadLark(config.pluginDir);
  larkClient = new LarkSdk.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: LarkSdk.Domain.Feishu,
  });
}

// 飞书长连接是集群模式：同一 app 有多条连接时，事件随机投递给其中一条，不广播。
// 因此只在降灵期间持有连接——未降灵的 daemon 若常挂连接，会把本应发给
// 已降灵 daemon 的消息吞掉（两台机器共用同一 bot 时必然踩中）。
function connectFeishuWs() {
  if (wsClient || !config) return;
  const LarkSdk = loadLark(config.pluginDir);
  const dispatcher = new LarkSdk.EventDispatcher({}).register({
    "im.message.receive_v1": onFeishuMessage,
  });
  wsClient = new LarkSdk.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: LarkSdk.Domain.Feishu,
  });
  void wsClient.start({ eventDispatcher: dispatcher });
  log("feishu websocket client started");
}

function disconnectFeishuWs() {
  if (!wsClient) return;
  // close() 是 1.73+ 才有的公开方法；防御一下旧版 SDK
  const closable = wsClient as unknown as { close?: (params?: { force?: boolean }) => void };
  try {
    closable.close?.();
    log("feishu websocket client closed");
  } catch (error) {
    console.error("[feishu-seance] feishu ws close failed:", error);
  }
  wsClient = null;
}

// 模块加载时初始化一次（插件子进程随 contribute 一起求值）。
// 有持久化绑定（daemon/插件重启恢复）时立即重连长连接。
config = loadConfig();
ensureLarkClient();
loadState();
if (binding) connectFeishuWs();
if (!config) log("no config found, running in dry-run mode; expected at", configPath);

export function handleBind(
  input: RpcInput<typeof seanceBind>,
  { paseo }: PluginHandlerContext,
): RpcOutput<typeof seanceBind> {
  ensureSession(paseo);
  binding = { agentId: input.agentId, workspaceId: input.workspaceId, title: input.title, boundAt: new Date().toISOString() };
  saveState();
  subscribeBoundAgent();
  connectFeishuWs();
  void sendToFeishu(`🔮 已降灵：${input.title ?? input.agentId}`);
  return { ok: true, configured: config !== null };
}

export function handleUnbind(): RpcOutput<typeof seanceUnbind> {
  releaseBinding();
  return { ok: true };
}

export function handleStatus(
  _input: RpcInput<typeof seanceStatus>,
  { paseo }: PluginHandlerContext,
): RpcOutput<typeof seanceStatus> {
  // status 查询也顺手复活 paseo 引用与订阅（daemon 重启后第一次 RPC 时恢复）
  const first = !paseoApi;
  ensureSession(paseo);
  if (first) {
    subscribeBoundAgent();
    void dropBindingIfGone();
  }
  // 长连接只随降灵持有；绑定仍在而连接缺失（如启动时建连失败）时补连
  if (binding) connectFeishuWs();
  return {
    configured: config !== null,
    configPath,
    binding,
    forwardedTurns,
  };
}

export function shutdownSeance() {
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  unsubscribeDirectory?.();
  unsubscribeDirectory = null;
  disconnectFeishuWs();
  // lark 的定时器和订阅可能仍吊住事件循环，导致子进程退不出、
  // daemon 卡在 "Stopping plugin"。cleanup 里兜底直接退。
  larkClient = null;
  setTimeout(() => process.exit(0), 200);
}
