# dsh-codex

[![test](https://github.com/OWNER/REPO/actions/workflows/test.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/test.yml)

> Replace `OWNER/REPO` in the badge with your GitHub user and repository name.

English | [简体中文](README.zh-CN.md)

Delegate heavy work to your local **Codex CLI** (defaults to `gpt-6.1-sol` with `max` reasoning
effort) and bring back only the **final answer** into the main context.

## Why

Main-model tokens should be spent on judgement; Codex quota on compute. This plugin therefore
returns only the text that `-o/--output-last-message` writes, and **never pipes process logs into
the context** — otherwise delegating would cost more than doing the work directly.

The trade-off: the main conversation sees no intermediate steps. That is why it only fits
**self-contained** tasks.

## Tools

| Tool | Purpose |
| --- | --- |
| `codex_delegate` | Run one delegation: task + cwd + sandbox + timeout, returns the final answer |
| `codex_status` | Show the resolved executable, its version and every candidate; no model call, free |

### When delegation pays off

- The task can be stated in one paragraph and needs **no back-and-forth**
- It requires reading many files / running commands / independent code changes, and you only need a conclusion or a diff
- Failure is acceptable and a retry is cheap

### When it does not

- You need to judge step by step, or inspect intermediate output
- The deliverable *is* a long document (bringing it back costs more than redoing it)
- Small jobs — the cold-start overhead alone exceeds the savings

## Supported Codex installations

Codex is not a single program; it ships in several local forms. **Any one of them is enough** — the
plugin finds it automatically:

| Form | Typical location | Status |
| --- | --- | --- |
| CLI · npm / brew / install.sh | `codex` on `PATH`; `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.bun/bin` | Supported |
| Desktop app (Windows) | `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\` | Supported, **tested** |
| Desktop app (macOS) | CLI bundled inside `/Applications/Codex.app` (recursive search, depth ≤ 5) | Supported, not tested |
| IDE extension · VS Code / Cursor / Windsurf / VSCodium | `~/.vscode/extensions/openai.chatgpt-*/bin/<platform>/codex` and similar | **Tested**: discovery and a real call both pass |
| Explicit override | VS Code setting `chatgpt.cliExecutable`; env var `DSH_CODEX_EXE` | Supported, highest priority |
| Codex Web / Cloud | Cloud only, no local binary | **Unsupported** — nothing to execute |

Resolution order: **complete > explicitly configured > newest**. On Windows, "complete" means
`codex-command-runner.exe` sits next to `codex.exe`; macOS and Linux have no such helper, so they
always count as complete.

Not sure what it found? Run `codex_status`; it lists every candidate and the one in use:

```
Codex available
  path:    C:\Users\...\bin\c38161ad8494f88c\codex.exe
  version: codex-cli 0.169.0-alpha.11.1
3 candidates, in priority order:
  · ...\bin\c38161ad8494f88c\codex.exe  <- selected
  · ...\.vscode\extensions\openai.chatgpt-26.1007.21434-win32-x64\bin\windows-x86_64\codex.exe
  · ...\bin\f71a721e0e6193a9\codex.exe  (missing command runner)
```

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| Windows | **Tested** | Used daily; see the command-runner caveat below |
| macOS | Adapted in code, **not tested** | Main differences are binary discovery and process termination |
| Linux | Same as macOS | Not tested |

Three places branch on platform:

1. **Binary discovery** — see the section above; every form is scanned, with `which`/`where` as the last resort.
2. **Process termination** — Windows uses `taskkill /T /F`; on POSIX the child is spawned `detached` and killed via `process.kill(-pid, 'SIGKILL')` so grandchildren die too.
3. **Command runner** — only Windows has the separate `codex-command-runner.exe`; the check is skipped on macOS/Linux.

The `codex exec` flags (`-m`, `-s`, `-c model_reasoning_effort="max"`, `-o`, `--ephemeral`) are
identical on every platform, so there is no per-OS command split. The sandbox backend differs
(Seatbelt on macOS, a bundled helper on Windows) but the public tiers are the same:
`read-only | workspace-write | danger-full-access`.

## Known constraints (observed on Windows)

- **Every cold start costs ~2 minutes.** `codex doctor` reports a WebSocket handshake timeout
  (`wss://chatgpt.com/backend-api/...`, 15 s connect timeout) before falling back to HTTPS, with
  several retries. There is **no configuration switch to disable it**: `websockets`, `transport`,
  `connect_timeout_ms` and similar keys are all rejected as unknown under `--strict-config`.
  Hence `timeoutSec` defaults to 900.
- Authentication uses ChatGPT account quota (`~/.codex/auth.json` holds OAuth tokens); there is no
  per-token API billing.
- **Caveat: incomplete installs exist.** Some `bin\` directories contain only `codex.exe` and are
  missing `codex-command-runner.exe`; using them fails with "command execution component missing"
  after a five-minute wait. `resolveCodexExe()` therefore prefers directories that contain the
  runner, then the newest one. If your `config.toml` still points `CODEX_CLI_PATH` at such a
  directory, ignore it — the plugin scans on its own.

## Safe defaults

`sandbox` defaults to **`read-only`**: analysis and reading only. To let it modify files you must
pass `workspace-write` explicitly, and then `cwd` / `addDir` decide what it may write.

## Install

First make sure a Codex binary is available (`codex --version`). If not: `npm install -g @openai/codex`,
or install the Codex desktop app (it will be discovered automatically).

Windows:

```powershell
New-Item -ItemType Junction -Path ~\.dsh\plugins\dsh-codex -Target C:\path\to\dsh-codex
New-Item -ItemType Junction -Path ~\.dsh\profiles\<profile>\node_modules\dsh-codex -Target ~\.dsh\plugins\dsh-codex
```

macOS / Linux:

```bash
mkdir -p ~/.dsh/plugins ~/.dsh/profiles/<profile>/node_modules
ln -s /path/to/dsh-codex ~/.dsh/plugins/dsh-codex
ln -s ~/.dsh/plugins/dsh-codex ~/.dsh/profiles/<profile>/node_modules/dsh-codex
```

Then edit the profile's `package.json`:

```
dependencies += "dsh-codex": "file:/path/to/dsh-codex"
dsh.profile.bundles += "dsh-codex"
```

DSH remounts the profile after the change; restart once if it does not.

## Testing (no DSH required)

```powershell
# 1) Platform resolution: list every codex binary found; free
node smoke/test-resolve.mjs

# 2) Isolated discovery: fake directory layouts for "extension only", "broken desktop install", ...
node smoke/test-discovery.mjs

# 3) Smoke test: stub out dsh-tools, verify registration, structure and argument validation; no model call
cd smoke
node --no-warnings --experimental-loader ./loader.mjs ./test.mjs

# 4) A real run (spends quota; ~2 min cold start)
cd ..
node test-run.mjs "Reply with exactly: OK"                        # read-only
node test-run.mjs "Create a.txt in the current directory" --write  # allow writes
```

> Pass a **relative** path to `--experimental-loader`. Node rejects absolute Windows paths with
> `ERR_UNSUPPORTED_ESM_URL_SCHEME`.

## Continuous integration

`.github/workflows/test.yml` runs the three offline tests above on
`ubuntu-latest` / `macos-latest` / `windows-latest` with Node 22 and 24.

CI proves the discovery logic, module loading and argument validation work on all three platforms.
It **cannot** prove that `codex exec` actually reaches the model — the runners have no Codex login,
and burning quota in CI would be wrong. That last step has to be verified once on a machine with a
real account.
