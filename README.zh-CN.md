# dsh-codex

[![test](https://github.com/xushengqiong-ship/dsh-codex/actions/workflows/test.yml/badge.svg)](https://github.com/xushengqiong-ship/dsh-codex/actions/workflows/test.yml)

[English](README.md) | 简体中文

把重活外包给本机 **Codex CLI**（默认 `gpt-6.1-sol` + `max` 推理档），只把**最终答复**拿回主上下文。

## 为什么

主模型的 token 应该花在「判断」上，Codex 的额度花在「算」上。
所以这个插件刻意只回传 `-o/--output-last-message` 写出的那一段答复，**不搬进程日志**——
否则外包反而更贵。

代价：主对话看不到中间过程。所以它只适合**自包含**任务。

## 工具

| 工具 | 用途 |
| --- | --- |
| `codex_delegate` | 跑一次委派：任务 + 目录 + 沙箱 + 超时，返回最终答复 |
| `codex_status` | 查可执行文件、版本和所有候选，不调用模型、不花钱 |

### 什么时候值得委派

- 任务能用一段话描述清楚，且**不需要来回商量**
- 需要大量读文件 / 跑命令 / 独立改代码，而我只需要一句结论或一段 diff
- 失败也无所谓，重来一次的成本可接受

### 什么时候别用

- 需要我逐步判断、需要看中间过程
- 产出本身就是大段文本（那样回传的 token 比重做还贵）
- 小活儿——冷启动成本都收不回来

## 支持的 Codex 形态

Codex 不是单一软件，本地至少有这几种形态。**任意一种存在就能用**，插件会自动去找：

| 形态 | 典型位置 | 状态 |
| --- | --- | --- |
| CLI · npm / brew / install.sh | PATH 上的 `codex`；`/opt/homebrew/bin`、`/usr/local/bin`、`~/.volta/bin`、`~/.bun/bin` | 支持 |
| 桌面 App（Windows） | `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`、`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\` | 支持，**已实测** |
| 桌面 App（macOS） | `/Applications/Codex.app` 内部自带 CLI（深度≤5 递归找） | 支持，未实测 |
| IDE 扩展 · VS Code / Cursor / Windsurf / VSCodium | `~/.vscode/extensions/openai.chatgpt-*/bin/<platform>/codex` 等 | **已实测**：发现 + 实际调用都通过 |
| 用户显式指定 | VS Code 设置的 `chatgpt.cliExecutable`；环境变量 `DSH_CODEX_EXE` | 支持，优先级最高 |
| Codex Web / Cloud | 只有云端，本地无二进制 | **不支持**，没有可执行文件可调 |

解析顺序：**完整 > 用户显式指定 > 最新**。Windows 上「完整」指同目录有 `codex-command-runner.exe`；
mac/Linux 没有这一层，一律算完整。

找不到或想确认？跑 `codex_status`，它会列出所有候选和最终采用的那个：

```
Codex 可用
  路径：C:\Users\...\bin\c38161ad8494f88c\codex.exe
  版本：codex-cli 0.169.0-alpha.11.1
发现 3 个候选（按优先级排序）：
  · ...\bin\c38161ad8494f88c\codex.exe ← 采用
  · ...\.vscode\extensions\openai.chatgpt-26.1007.21434-win32-x64\bin\windows-x86_64\codex.exe
  · ...\bin\f71a721e0e6193a9\codex.exe （缺执行组件）
```

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows | **实测通过** | 本机日常使用；有 command-runner 的那个坑（见下） |
| macOS | 代码层适配，**未实测** | 主要差异是 exe 发现路径和杀进程方式，已分别处理 |
| Linux | 同 macOS | 未实测 |

跨平台相关的三处，代码里都做了分支：

1. **可执行文件发现**：见上一节，按形态逐个来源扫，最后用 `which`/`where` 兜底。
2. **杀进程**：Windows 用 `taskkill /T /F`；POSIX 下 `spawn` 开 `detached` 进程组，超时用 `process.kill(-pid, 'SIGKILL')` 连子孙一起收。
3. **执行组件**：只有 Windows 有 `codex-command-runner.exe` 这一层；mac/Linux 不适用，判定直接跳过。

`codex exec` 的参数（`-m` / `-s` / `-c model_reasoning_effort="max"` / `-o` / `--ephemeral`）两边一致，无需分叉。
沙箱实现在 mac 上是 seatbelt、Windows 上是自带的 helper，但对外都是 `read-only|workspace-write|danger-full-access` 三档。

## 已知环境约束（Windows 实测）

- **每次冷启动约 2 分钟**：`codex doctor` 显示 WebSocket 握手超时
  （`wss://chatgpt.com/backend-api/...`，连接超时 15s，之后才回退 HTTPS，还要重试几次）。
  已确认**没有配置项能关掉**：`websockets` / `transport` / `connect_timeout_ms` 等键
  在 `--strict-config` 下全部被判为 unknown。所以 `timeoutSec` 默认 900。
- 认证走 ChatGPT 账号额度（`~/.codex/auth.json` 是 OAuth tokens），不按 API token 计费。
- **踩过的坑**：`bin\` 下有时有不完整的安装目录（只有 `codex.exe`，缺 `codex-command-runner.exe`）。
  用它一执行命令就报「命令执行组件缺失」，还白等五分钟。所以 `resolveCodexExe()` 优先选**带执行组件**的目录，
  同组内再取最新。如果你的 `config.toml` 里 `CODEX_CLI_PATH` 还指着这种残缺目录，忽略它——插件自己会扫。

## 安全默认

`sandbox` 默认 **`read-only`**：只是分析、读文件。要它真的改文件必须显式传 `workspace-write`，
并且此时 `cwd` / `addDir` 决定了它能写哪儿。

## 装法

先确认 Codex 可用（`codex --version`）。没有的话：`npm install -g @openai/codex`，
或装 Codex 桌面版（本机会被自动发现）。

Windows：

```powershell
New-Item -ItemType Junction -Path ~\.dsh\plugins\dsh-codex -Target C:\path\to\dsh-codex
New-Item -ItemType Junction -Path ~\.dsh\profiles\<profile>\node_modules\dsh-codex -Target ~\.dsh\plugins\dsh-codex
```

macOS / Linux：

```bash
mkdir -p ~/.dsh/plugins ~/.dsh/profiles/<profile>/node_modules
ln -s /path/to/dsh-codex ~/.dsh/plugins/dsh-codex
ln -s ~/.dsh/plugins/dsh-codex ~/.dsh/profiles/<profile>/node_modules/dsh-codex
```

然后改 profile 的 `package.json`：

```
dependencies += "dsh-codex": "file:/path/to/dsh-codex"
dsh.profile.bundles += "dsh-codex"
```

改完 DSH 会重新挂载 profile；不行就重启一次。

## 自测（不依赖 DSH）

```powershell
# 1) 平台解析：列出所有找到的 codex 可执行文件，不花钱
node smoke/test-resolve.mjs

# 2) 隔离发现测试：造假目录，验证「只有 IDE 扩展」「桌面版残缺」等场景的排序
node smoke/test-discovery.mjs

# 3) 冒烟测试：桩替换 dsh-tools，验证注册/结构/参数校验，不调模型、不花钱
cd smoke
node --no-warnings --experimental-loader ./loader.mjs ./test.mjs

# 4) 真跑一次（花额度，冷启动约 2 分钟）
cd ..
node test-run.mjs "只回答三个字：跑通了"          # 只读
node test-run.mjs "在当前目录建 a.txt" --write   # 允许写
```

> `--experimental-loader` 必须传**相对路径**。Node 在 Windows 上会拒绝绝对路径，
> 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。

## 持续集成

`.github/workflows/test.yml` 在 `ubuntu-latest` / `macos-latest` / `windows-latest` 上
用 Node 22 和 24 跑上面三个离线测试。

CI 能证明发现逻辑、模块加载、参数校验在三平台上都正常；**不能**证明 `codex exec` 真能连上模型
——runner 上没有 Codex 登录态，也不该把额度烧在 CI 里。最后这一步只能在有账号的机器上验一次。
