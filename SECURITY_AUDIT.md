# LinkEntryGuard 1.0.0 — 第三轮完整安全审核报告

**审核日期**：2026-11-21
**来源**：用户已安装并实际看到确认页的 `LinkEntryGuard_1.0.0_ClickConfirm.zip`。本次审核从该 ZIP 解包、逐文件检查、修复，再重新打包。**不是**从前一轮总结推断源码。
**产品版本**：保持 `1.0.0`，没有修改产品开关策略。
**结论**：本轮确定的 8 项可安全处理问题已修改并通过本地测试；仍存在 4 项需要产品层取舍，以及受 Chrome API 限制的剩余风险。**尚不能宣称“所有网页/链接 100% 拦截”或“真实 Chrome 端到端测试通过”。**

## 1. 项目概况和审核范围

| 项目 | 检查结果 |
|---|---|
| 技术栈 | Chrome Extension，Manifest V3，原生 JavaScript / HTML / CSS；无后端服务 |
| 原始包目录 | `LinkEntryGuard_1.0.0_ClickConfirm/` |
| 源码与资料 | 共 25 个原始条目（文件，排除 ZIP 目录项；本轮另增加 1 个测试文件）；源码、图标、规则、测试、README、审计报告均检查 |
| 直接第三方依赖 | **0**；无 `package.json`、`node_modules`、npm/pnpm/yarn lock、`requirements.txt`、`go.mod`、`Cargo.toml`、`pom.xml`、`Podfile` |
| 间接依赖实际版本 | **无**；未出现第三方依赖树 |
| 依赖漏洞扫描 | `npm audit` / `pnpm audit` / `pip-audit` 等不适用：不存在相应包清单；不能将“不适用”表述为扫描发现 0 CVE |
| 官方依据 | Chrome DNR、MV3 规则生命周期、消息来源验证、安全权限说明（文末官方链接） |
| Git / CI | 源 ZIP 中**无 `.git` 目录，也无 `.github/workflows`**；当前版本历史、已提交过的密钥、远程 CI 配置不能验证，列为「待确认」 |
| 浏览器实测 | 用户截图证明**一次** `www.google.com` 的确认页面真实出现；本容器 Chromium 144 的 `chrome://extensions` 与本地导航被运行环境拒绝，后台未能确认启动，因此**实机完整回归：待确认** |

### 全部可执行内容

- `background.js`：网络拦截动态规则、批准许可、日志、消息接口、故障清理。
- `policy.js`：HTTP(S) URL 校验、Teams 域名校验、域名日志脱敏。
- `teams-guard.js`：Teams 网页链接捕获；鼠标、键盘、拖动拦截。
- `page-click-guard.js`：普通网页 HTML 超链接捕获并显示确认标签。
- `confirm.js` / `confirm.html` / `confirm.css`：确认页、取消与批准。
- `popup.js` / `popup.html` / `popup.css`：状态与日志查看、清理。
- `manifest.json` / `rules/failsafe.json`：权限、内容脚本、静态阻断规则。
- `tests/*.js`：事件、规则、确认、弹窗及故障注入测试。
- `icons/*.png`：本地图标；无可执行代码、远程引用或凭据。

## 2. 问题汇总表

下表的文件行号为**本次修复后版本**的对应检查/修复位置。高低等级根据该应用的使用目标、真实利用前提和影响决定；**不伪造 CVE 编号**。

| 编号 | 类别 | 严重级别 | 位置（修复后） | 风险 / 利用条件 | 状态 |
|---|---|---|---|---|---|
| LEG-A01 | 代码 | Medium | `background.js:170-213` | Chrome API 临时拒绝撤销会话放行规则时，旧实现先从 Map 删除跟踪状态，可能在本浏览器会话留下未被及时清理的放行；需遭遇 API 异常 | **已修复** |
| LEG-A02 | 代码 | Medium | `background.js:214-229` | DNR `regexFilter` 默认大小写不敏感；批准 `/Token=A` 可能放行 `/token=a` 等不同 URL（限同标签、同规则有效期） | **已修复** |
| LEG-A03 | 代码 | Medium | `background.js:86-105,142-150` | 假设 static fallback 已启用，但 Chrome 允许静态规则集及规则被禁用；旧弹窗可能错误显示 ON | **已修复** |
| LEG-A04 | 代码 | Medium | `background.js:68-85,106-125` | 旧检查只要求动态规则存在、类型为 redirect；配置被改变后可能失去全站覆盖却显示正常 | **已修复** |
| LEG-A05 | 代码 | Medium | `background.js:23-55`、`tests/privacy-failure.js` | `storage.local` 默认可供内容脚本访问；旧代码即使设置 `TRUSTED_CONTEXTS` 失败仍写入域名访问日志 | **已修复** |
| LEG-A06 | 代码 | Low | `background.js:127-137,325-349` | 初始启动、`onInstalled`、`onStartup` 检查可能并发更新同一条动态规则，增加启动异常风险 | **已修复** |
| LEG-A07 | 代码 | Low | `background.js:271-289` | 将浏览器 API 的原始错误消息直接放到确认页可能意外暴露网址、查询参数等敏感内容 | **已修复** |
| LEG-A08 | 代码 | Low | `background.js:138-150,318-330` | 故障/恢复后徽标有机会与真实健康状态不同步；用户无法准确判断保护状态 | **已修复** |
| LEG-D01 | 代码/行为 | Medium | `page-click-guard.js:5-36`、`manifest.json:45-64` | `history.pushState`、JS 按钮、特殊 SPA 导航不一定形成 HTTP(S) 主请求，不能依靠 DNR 全覆盖；扩大点击拦截范围会破坏网站功能 | **待开发者决定** |
| LEG-D02 | 代码/隐私 | Medium | `background.js:15,56-66`、`confirm.js:7-18` | DNR 通过确认页 hash 携带完整原 URL；含令牌的网址会临时暴露在地址栏、确认页及可能的浏览器历史中 | **待开发者决定** |
| LEG-D03 | 代码/行为 | Medium | `background.js:214-241,309-323` | “允许本次”是**同标签 + 完整 URL + 临时 DNR allow 规则**，并非浏览器底层原子的一次请求许可。提交前的并发同 URL 请求、工作线程停用后过期撤销延迟需接受或重构 | **待开发者决定** |
| LEG-D04 | 代码/行为 | Low | `page-click-guard.js:24-36` | 点击普通网页链接会在新标签显示确认页，即使原链接原本应在当前标签打开；改变用户浏览路径 | **待开发者决定** |
| LEG-R01 | 平台 | Medium | `rules/failsafe.json:1-12`、`manifest.json:64-86` | DNR 仅拦截进入网络请求路径的受支持类型；`file://`、`chrome://`、外部协议、部分 Service Worker / CacheStorage 导航不在同一覆盖面 | **建议关注** |
| LEG-R02 | 平台 | Medium | `background.js:170-213` | 若 Chrome API 长期拒绝删除规则且后台/闹钟停用，临时 allow 仍可能存在至浏览器会话结束或下一次成功清理；纯插件无法硬保证严格到秒撤销 | **建议关注** |
| LEG-R03 | 密钥 | Low | `.gitignore:1-11`、本次所有文本/资源 | 当前分发包未发现实际密钥；无法证明 Git 历史未提交过敏感数据，因为没有仓库元数据 | **待确认** |
| LEG-R04 | CI/CD | Low | 源 ZIP 无工作流 | 无现存 CI 工作流可审核；若存在远程 GitHub Actions，必须另外核对 action 固定版本、`pull_request_target` 和机密注入 | **待确认** |

## 3. 实际修改清单（已落地）

1. **不再遗失未撤销的放行（LEG-A01）**：先调用 `updateSessionRules(removeRuleIds)`，成功后才删除内存映射、计时器；失败时保留 `needsRemoval` 状态，显示 `ERR`，由后续健康检查与闹钟重试。`get-status` 在故障未恢复时返回异常，不再报健康。`tests/confirm-integration.js` 新增模拟 Chrome 删除规则失败、修复后再清理的断言。
2. **精准 URL 匹配（LEG-A02）**：临时放行规则显式设置 `isUrlFilterCaseSensitive:true`。官方文档确认省略时默认 `false`，这不是推测。增加规则属性测试。
3. **兜底规则完整性（LEG-A03）**：通过 `getEnabledRulesets`、`getDisabledRuleIds` 校验静态规则集与规则，并在发现被禁用时尝试恢复。异常时拒绝新的确认放行，且状态改为异常。
4. **动态规则完整性（LEG-A04）**：检查规则 ID、优先级、动作、重定向目标、主框架条件以及是否夹带限制条件；如被改动则重新安装。避免仅靠数字 ID 判健康。
5. **日志隔离失败时保护隐私（LEG-A05）**：在 `storage.local.setAccessLevel` 成功之前不写日志；失败时停止持久记录并尝试清除既有记录。新增 `tests/privacy-failure.js`。
6. **防启动竞争（LEG-A06）**：初始化与全局规则检查增加同一任务复用（single-flight），避免多个事件同时重复改写规则。
7. **错误信息收敛（LEG-A07）**：确认页仅显示固定、无敏感参数的错误提示；不再显示未知浏览器 API 原始错误消息。
8. **状态徽标同步（LEG-A08）**：启动、健康检查、定时清理及异常时更新 `ON/ERR` 状态，减少错误安全感。
9. **文案准确性**：确认页不再声称严格的“仅发生一次网络请求”，改成“临时允许当前标签访问这个网址，不建立永久白名单”；Manifest 描述明确限制为 HTTP/HTTPS 主页面请求。

以上修改没有新增第三方包、后端、联网服务或功能关闭入口；`manifest.json` 的产品版本仍是 `1.0.0`。

## 4. 需要开发者决定的取舍

| 议题 | 方案 A | 方案 B | 本次建议 |
|---|---|---|---|
| SPA / JS 产生的无网络导航 | 保留目前“真实超链接 + 主请求”覆盖；不破坏网站按钮 | 全局更激进地拦截页面脚本/点击，可能破坏导航、登录和 Teams | **保留 A**，再按真实出现的绕过情况单独增加适配；不应假装“100% 任何点击” |
| 完整 URL 在确认页 hash | 接受本地临时暴露，避免分享含令牌的确认页地址 | 重设计目标网址交付方式（例如受限队列/token），可能引入导航竞争和新失败模式 | **先保留 A**，需用户决定是否以隐私换复杂性 |
| 临时放行的绝对单次语义 | 同标签/精确网址，通常提交后撤销，25 秒定时器及闹钟兜底 | 引入系统级 URL 处理器/策略或复杂导航协调器，改变部署和可用性 | **保留 A**，不再承诺“原子一次”或毫秒级到期 |
| 普通网页点击的新标签行为 | 保留原页面、新标签显示确认页 | 按原链接 `_self/_blank` 语义打开确认页，可能覆盖用户当前页面 | **保留 A**，待用户确认交互偏好 |

## 5. 专项安全复核

| 检查方向 | 结论 |
|---|---|
| XSS / HTML 注入 | `confirm.js`、`popup.js` 使用 `textContent`；没有 `innerHTML`、动态 HTML 模板、远程可执行 JS：**未发现可利用注入** |
| SQL/NoSQL/命令注入 | 无数据库、shell 进程启动或服务端查询：**不适用** |
| 远程加载代码 / `eval` | 运行时代码仅本地扩展文件；未使用 `eval` / `new Function` / 远程脚本；测试中的 Node `vm` 仅开发用途 |
| 消息鉴权 / 越权 | `isPopup`、`isConfirm`、`isPageContent`、`isTeamsContent` 限定 sender 的浏览器提供来源、tab、frame；批准还核验实际标签 URL：**通过静态审核及模拟测试** |
| CSRF / SSRF / 开放重定向 | 扩展不接收外部网络 HTTP 请求、不做服务端 fetch；确认后的跳转仅由用户允许的本地页面触发：无服务器 SSRF；需保留对用户确认的社工风险认知 |
| TLS/加密 | 无自建密码学、弱加密或关闭 HTTPS 证书校验的代码：**未发现** |
| 文件处理 / 解压 | 运行时不读取本地文件、不上传或解压；审核脚本按安全相对路径解包输入 ZIP |
| 权限最小化 | `tabs/storage/webNavigation/alarms/declarativeNetRequest` 和全 HTTP(S) host 权限与当前全站保护、日志、确认许可相关；**权限很广，但属于明确业务范围，不贸然删权限** |
| 敏感日志 | 持久日志只存主机名/时间/原因；修补 storage 隔离失败时的写入；确认页 hash 仍暴露完整 URL：见 LEG-D02 |
| 桌面 IPC / WebView / Electron | 项目不是桌面应用，相关事项不适用 |
| 历史密钥 | 当前分发包没发现实际凭据，历史 Git 不可查：**待确认** |

**一旦未来发现曾经提交过真实 API Key、Token 或私钥，必须在对应服务端撤销并轮换，再删除仓库中的秘密；仅修改代码并不足够。** 本项目当前无需要读取的环境变量，因此没有生成仅作摆设的 `.env.example`。

## 6. 验证执行及证据

执行环境：Node.js `v22.16.0`；Chromium `144.0.7559.96`（容器环境）。

```bash
cd LinkEntryGuard_1.0.0_ClickConfirm
for f in tests/*.js; do node "$f" || exit 1; done
for f in *.js tests/*.js; do node --check "$f" || exit 1; done
```

- **7 组 Node 测试文件运行通过**：确认规则与会话许可、确认页行为、网页点击、弹窗健康状态、Teams 点击、URL/Manifest、隐私隔离故障。
- 新增故障注入涵盖：会话放行规则删除失败后不能误报 ON；恢复后清理；静态兜底规则被禁用时恢复；动态规则被篡改时修正；大小写精确允许；日志隔离失败时不保存记录。
- 所有运行时 JS 及测试 JS 的 `node --check` **通过**。
- **真实 Chromium 端到端：未通过验证**。容器尝试访问 `chrome://extensions` 与本地测试页面，均返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`，没有可确认的扩展服务工作线程；这属于环境限制或策略，**不能证明产品在真实电脑上出错，也不能把它算作通过**。
- **用户实机证据**：已经出现 `www.google.com` 的本地确认页，说明至少那次 DNR 确认重定向生效；确认之后的撤销、并发、Teams/TIM 以及不同浏览器条件仍需在用户设备验收。

### 重点手工验收（应在测试 Profile 执行）

1. Teams 桌面版、TIM、邮件应用分别点击普通 `https://www.google.com/`，应先出现确认页；取消后不得加载目标页面。
2. 地址栏粘贴同一网址，确认后正常访问；再次新建标签直接访问应重新确认。
3. 打开一个普通站点，点击 HTML 超链接、Ctrl+点击、中键和菜单在新标签打开，检查均未悄悄直达网站；注意网站 JS 按钮例外。
4. 确认时测试一次含大小写路径的网址（例如 `/Case`），确保其他大小写形式不能复用许可。
5. 点击确认后马上打开另一条链接，必须重新确认；等待超过许可 TTL，再次访问同一 URL 不得沿用旧授权。
6. 测试登录重定向、浏览器前进/后退、页面刷新、关闭确认标签、多个 Profile 并发，确认未误放行和未出现死循环。
7. 模拟扩展错误时观察 `ERR`，在 `chrome://extensions` 检查服务工作线程日志；**测试期间不要随意关闭静态兜底规则**。

## 7. 后续建议与官方依据

- **优先做实机回归**，重点关注批准后会话规则撤销和登录跳转；静态/模拟测试不能替代 Chrome DNR 实际执行顺序。
- 继续保留“请求前确认 + 静态兜底阻断”，不要重新退回仅凭 `tabs.onCreated` 猜测 Teams 进程的策略。
- 不把它宣传成反病毒、恶意网址扫描器或系统级默认链接处理器。它减少误打开，却不识别网站是否可信。
- 如果未来将项目放到 GitHub，请加入受保护分支与 CI 测试，并检查历史与仓库 Actions 的来源及权限；这个 ZIP 不能证明远程仓库的状态。

**官方资料（2026-11-21 核对）：**

- [Chrome `declarativeNetRequest` 文档](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)：规则优先级、`getEnabledRulesets`、`getDisabledRuleIds`、`isUrlFilterCaseSensitive`、session/dynamic/static 生命周期、Service Worker/CacheStorage 限制。
- [Chrome 扩展消息传递](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)：校验 `sender` 和处理来自内容脚本的数据。
- [Chrome 扩展 Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：工作线程可能休眠，不能将 JS timer 视作精确、永不失效的服务。

**报告性质**：静态/单元/模拟安全审核 + 有限 Chromium 启动检查；不是独立渗透测试报告，也不是安全认证。
