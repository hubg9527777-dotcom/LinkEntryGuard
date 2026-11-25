# LinkEntryGuard 1.0.2 — 安全复审报告

审核日期：2026-11-25。审核基线：`LinkEntryGuard_1.0.2_NavigationSafety.zip`，内部构建 `1.0.2-r20261125.8`。修订构建 `1.0.2-r20261125.9`。产品版本始终为 1.0.2。

**结论：可作为本地验收候选；暂不建议正式发布，Checkout 已获批准并升级，待实机复验及远程 Actions 验证。** 本报告针对所获源码快照，不是用户本机或远程 Git 历史的审计证明。不将模拟测试视为 Chrome 实机测试，不宣称不存在未知漏洞。

## 1. 项目概况及范围

- Chrome Manifest V3 扩展，原生 JavaScript、HTML、CSS，Service Worker 后台，DNR 网络拦截；无服务端、数据库、桌面 IPC、远程代码加载、第三方运行库。
- 基线 ZIP 内 59 个文件，其中 55 个 UTF-8 文本、4 个 PNG；含 11 个根目录 JS、3 个 HTML、3 个 CSS、Manifest、静态 DNR JSON、SVG/PNG 图标、16 个 Node 测试脚本、GitHub Actions YAML、忽略配置及历史文档。检查这些文件的源码、配置、数据流和静态资产引用；测试源码也在扫描范围内。
- 无 package.json、lock、requirements、go.mod 等依赖清单；Node 测试只使用标准库，未安装第三方包。构建采用 Git archive 明确文件清单；本地 Node v22.16.0。
- 当前输入 ZIP 无 .git，因此无法核验过去提交、分支/标签保护、远程仓库实际代码和已发布资产。

## 2. 问题汇总（位置为修订后文件，旧问题原始位置相近）

| ID | 类别 | 级别 | 位置 | 状态 |
|---|---|---|---|---|
| S01 | 代码 | Medium | background.js:514–562 | 已修复：临时规则安装后未立即核验，安装结果不明时缺少统一清理 |
| S02 | 代码 | Low | background.js:778–787 | 已修复：SPA 补充阻止可覆盖等待中的独立导航 |
| S03 | 代码 | Low | background.js:628–637 | 已修复：Teams 子框架可进入备注写入消息路径（须有扩展内容脚本执行能力） |
| S04 | 密钥/发布 | Low | .gitignore:24–29 | 已加固：额外排除本地压缩包、备份和常见凭据配置 |
| D01 | 依赖 | Medium | .github/workflows/release.yml:21,49 | 已修复：开发者批准升级至 v7.0.1，固定完整 SHA；远程执行待确认 |
| R01 | 代码/隐私 | Medium | background.js:179–183,290–300; confirm.js:10–19; lists.js:70 | 待开发者决定：完整 URL 可能进入确认页 fragment、本地名单及备份 |
| R02 | 代码 | Medium | background.js:418–502,514–562,755–775 | 建议关注：一次授权不是原子请求许可，Chrome 拒绝撤销与紧急阻断时无法保证保护 |
| R03 | 代码 | Medium | background.js:640–704; manifest.json | 待开发者决定：未授权无痕扩展运行时，后续导航不在保护范围 |
| R04 | 代码 | Medium | rules/failsafe.json; manifest.json; background.js:290–300,778–787 | 建议关注：DNR 仅主文档网络请求，POST/缓存/SPA/内部页等覆盖限制 |
| R05 | 代码 | Low | floating-label.js:4–66; manifest.json | 建议关注：网页内浮层不是可信浏览器安全界面，可能隐藏或仿冒 |
| R06 | 代码 | Low | background.js:124–151 | 建议关注：循环保护为内存启发式，后台重启/不同标签可重置 |
| R07 | 代码/隐私 | Medium | background.js:44–55,158–166,271 | 建议关注：本地明文与存储隔离初始化窗口，隔离失败保留名单以避免丢失策略 |
| R08 | CI/CD | Medium | .github/workflows/release.yml:3–6,41–79 | 待确认：远程标签保护、发布权限、实际 Actions 执行 |
| R09 | 密钥 | 待确认 | Git 历史（未提供） | 待确认：历史凭据泄露与本机敏感文件跟踪情况 |

评级为本项目定性风险，非 CVSS 或公开 CVE。S01–S04 是原安全复审实际修改项（1 Medium，3 Low）；D01 为随后获批的 Medium 依赖升级；没有发现可由当前快照证实的 Critical/High 漏洞。R 系列是设计边界或未验收风险，并非全部为可独立利用的漏洞。

## 3. 已修复问题、触发条件与验证

### S01 临时授权规则读回验证

基线 background.js:514–553 在 updateSessionRules 成功返回后记录并使用规则，但未在导航前读回核对，直至以后清理检查才发现规则不一致。如果实际规则缺失、与目标不一致，或者 API 返回失败且结果不明确，可能造成重复确认、未预期的放行范围或遗留规则。正常 Chrome API 按文档应原子地处理更新；没有证明网页可以任意修改 DNR 规则，故定性 Medium 防御加固，不宣称已存在可远程利用的绕过。

修改：在安装前记录尝试的临时规则；安装后读回所有会话规则，与已追踪规则逐一比较，检查 ID、优先级、action、精确 URL 正则及 tabIds 等完整结构。缺失、不匹配或出现未追踪规则时不发送导航，清理尝试的授权及孤立规则；撤销失败沿用既有紧急阻断和异常状态。正常成功路径、25 秒时限、黑名单优先、精确网址授权、同源提示均不改变。新增 tests/confirm-integration.js 故障注入：扩大 tabIds、规则缺失、安装结果异常、并发目标改变。

### S02 SPA 旧事件覆盖新导航

基线 background.js:770–779：历史地址变化后异步读取名单和当前标签；仅比对 tab.url，未检查 pendingUrl。用户此时在同一标签发起新的导航，可能被旧 SPA 黑名单处理覆盖。修改：不同 pendingUrl 存在时不再覆盖，新的网络导航仍按 DNR 规则处理。这不是关闭 SPA 黑名单检查。新增故障测试，原有正常 SPA 黑名单测试也保留。Chrome 事件异步，不保证绝对原子。

### S03 收窄 Teams 框架写入权限

基线 background.js:620–628 允许经 isTeamsContent 验证的子框架发送 save-ui；悬浮备注本身只在顶层运行，因此无功能必要。普通网页不能直接访问扩展消息端口；利用前提是能够控制扩展内容脚本执行或出现其他消息边界缺陷。修改：Teams 的 save-ui 必须 frameId===0，原有多框架 Teams 拦截与日志权限保留；测试子框架写入被拒绝。

### S04 发布文件防误提交

基线忽略规则覆盖 .env、证书及名单导出；本轮额外排除 *.zip、*.tar.gz、*.bak、credentials.json、secrets.json。此举仅防止新文件误加入 Git，不会自动取消跟踪已经提交的文件，不会删除文件。CI 明确安装包允许清单不变。

### 文档和构建标记

background.js、ui-transport.js 以及对应测试中的内部标记同步 .9；Manifest 版本仍 1.0.2。README 修正显示的构建号和无痕成功后原标签处理说明。将原 SECURITY_AUDIT.md 保留为 SECURITY_AUDIT_PRERELEASE_ARCHIVE.md，本报告作为当前版本报告。

## 4. 依赖漏洞与供应链核查

| 项目 | 当前实际配置 | 核查结论 |
|---|---|---|
| 第三方运行依赖 | 0 | 无 npm/pip 等依赖需审计 |
| actions/checkout | v7.0.1；3d3c42e5aac5ba805825da76410c181273ba90b1（两次使用同一依赖） | 官方 release 标记 Verified，链接至该完整 SHA；保留 v7 的安全默认值；项目仅在 tag push 时执行，不执行 PR head |
| Node.js | 本地 v22.16.0；GitHub runner 由 ubuntu-24.04 提供，Action 实际运行时 GitHub 已转 Node24 | 官方说明 v5 起原生支持 Node24，要求 runner 至少 v2.327.1；v7.0.1 已获批准升级，实际托管 runner 版本待远程验证 |
| Git / gh / unzip / sha256sum | GitHub runner 预装；没有项目锁定的实际版本 | 远程运行版本待确认；本地只验证 Git archive/unzip |
| Checkout 上游传递依赖 | 未 vendoring，项目无其锁文件 | 固定 SHA 固定 Action 内容；尝试获取该版本 action.yml、package.json 的在线请求未成功，上游锁文件与完整内部 SBOM 待确认，未编造实际版本 |

查询范围：GitHub Advisory Database、Checkout 官方安全页、release/changelog、OSV、NVD；精确 advisory 筛选及 raw 文件部分请求失败，搜索结果未发现明确适用于本工作流的 Critical/High 公告。不能据此宣称上游内部依赖全无漏洞。GitHub Checkout 官方安全页显示无已发布安全公告；不是独立漏洞数据库全量证明。没有使用 npm audit 等工具，因为不存在适用的包清单；本地未安装 gitleaks、trufflehog、osv-scanner。本轮未引入扫描器下载或依赖。

**D01 决策结果（2026-11-25）**：开发者明确批准 v7.0.1。两处 checkout 已更新为同一完整提交 SHA，保留 `persist-credentials: false`、固定 github.sha、仅标签触发及测试/发布权限隔离；不启用 `allow-unsafe-pr-checkout`。官方发布页显示签名已验证，提交页面确认完整哈希，发布说明包括 Git 配置参数转义及依赖更新。官方 README 声明 Node24 支持；没有在本地执行上游 Action，也没有独立验证签名。此次精确 action.yml 和安全公告页面抓取失败，内部依赖 SBOM 和远程 runner 兼容性仍待确认。D01 配置修复已完成，不代表上游所有漏洞已排除。插件运行文件及内部构建号 .9 不变。

本次追加核验来源：
- https://github.com/actions/checkout/releases/tag/v7.0.1
- https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1
- https://github.com/actions/checkout/blob/main/README.md

来源（本轮检索）：
- https://github.com/actions/checkout/releases/tag/v4.4.0
- https://github.com/actions/checkout/releases
- https://github.com/actions/checkout/blob/main/CHANGELOG.md
- https://github.com/actions/checkout/security
- https://github.com/advisories/
- https://osv.dev/ 与 https://nvd.nist.gov/
- https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/
- https://nodejs.org/en/about/eol
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest/

## 5. 逐文件安全检查与功能验收

| 文件/范围 | 核查内容与证据 |
|---|---|
| manifest.json、rules/failsafe.json | 权限为 tabs/storage/declarativeNetRequest/webNavigation/alarms/contextMenus，HTTP(S) 主机权限用于现有请求前确认及悬浮备注，未增加权限；仅 confirm.html web-accessible；无 externally_connectable；MV3 默认 CSP；静态 block 兜底 |
| background.js | 动态规则、黑名单优先级200、单次授权100、全局确认10、静态兜底1、紧急阻断1000；规则完整性、发送者页面/框架检查、名单快照、存储隔离、日志域名、临时授权清理、无痕和右键令牌；S01–S03 修补 |
| policy.js、list-tools.js | URL 正规化、禁止凭据、同源/目录/精确边界、正则转义、无效输入/协议拒绝、300条及大小限制、导入 JSON schema、去重与冲突保留；未发现动态执行或原型污染明确利用路径 |
| confirm.js/html/css | 原始目标比对、嵌入页禁用、普通/无痕按钮、取消、状态回读、连续访问提示；DOM textContent；未发现用户输入进入 HTML 执行点；确认 URL 隐私及导航竞争仍有平台边界 |
| list-quick.js、lists.js/html/css | 快捷增删、转换、备注、范围确认、单行悬停、连续操作、批量预览、导出、撤销、规则检测、并发快照；导入文件仅本地 JSON 解析，未执行或解压；输出使用文本节点；无自动访问或上传 |
| popup.js/html/css、ui-transport.js | 身份显示、状态与重试、只读请求重试与写入不重放、脱敏诊断、名称与悬浮开关；名单查询失败时禁用访问；UI 正常状态不是每个网页注入的证明 |
| floating-label.js | 顶层注入、closed shadow DOM、真实用户拖动/编辑入口、位置边界、事件同步；网页能隐藏/仿冒浮层，不能作为可信身份证明；不读取本地 Profile 配置文件 |
| teams-guard.js | Teams 专用捕获点击、键盘、中键、拖动、右键复制；未恢复普通网页通用点击抢占；无法保证识别所有网站脚本行为 |
| page-click-guard.js | 空兼容占位文件，不在 manifest 注入，保留 Google 九宫格修复 |
| icons/ | 4 PNG、1 本地 SVG；本地引用，无远程资源或脚本 |
| .github/workflows/release.yml、.gitignore | 仅 tag push，测试 contents:read、发布 contents:write，固定 SHA，不持久化 checkout 凭据，shell 变量引用、标签版本校验、Git archive 允许清单；D01 已升级；R08 待确认 |
| tests/*.js、README、历史报告和说明 | Node 标准库；无实际账户凭据；文档中历史版本与旧测试结论不作为本轮证据；测试为 API/DOM 模拟 |

SQL/NoSQL、服务器 CSRF/CORS/SSRF、命令注入、路径穿越、桌面 IPC、TLS 校验关闭、弱加密算法不适用或在当前源码中未发现对应调用面。没有服务端或数据库。浏览器 URL 跳转是产品功能，不等同于服务端开放重定向；仍须确认具体目标、协议和名单。未发现 eval/Function 动态执行、远程脚本加载、危险 HTML 注入点。不能替代动态渗透测试。

## 6. 凭据检查

本地模式扫描 59 个基线文件（55 文本、4 二进制图片），覆盖私钥标头、GitHub Token、AWS Key、Google API Key、OpenAI 风格 Key、JWT、常见 Webhook、数据库连接串、带凭据 URL、硬编码敏感变量；仅命中 tests/list-tools.js:8,25 与 tests/confirm-integration.js:248 的示例凭据网址，属于无效输入/安全回归夹具。GH_TOKEN 使用 GitHub 临时 token 环境变量，不是硬编码密钥。未发现实际密钥；不新增无意义 .env.example。无 .git，无法确认已跟踪文件历史与曾泄露凭据。若后续发现真实泄露，须立即作废、重新生成并检查访问记录，不能仅删源码。

## 7. 剩余风险与需要决定的事项

- R01/R07：DNR 重定向将完整目标放入 fragment；精确匹配规则、撤销备份、导出文件可含查询参数。日志持久化仅记录域名等，循环检测的 URL 正则仅内存保存。建议继续禁止保存敏感登录链接；未来可选择改变确认页 URL 传输机制，但必须证明能保留请求前保护和目标准确性，不能擅自使用网页发送的数据替代可信目标。存储隔离失败时拒绝名单读取和写入，既有名单没有被删除；不能保证底层浏览器隔离设置异常时已有数据完全不可访问。是否拒绝敏感参数或改变存储方式需开发者决定。
- R02：DNR 不提供某次重定向链专属授权，短时精确 allow 仍可能在撤销前被同一标签复用；Chrome 同时拒绝撤销与紧急规则时应停止使用该 Profile、重新加载扩展。建议保持原有安全策略，不自动扩大同源/跨站权限。
- R03：未授权扩展在无痕窗口中运行时，仍允许用户明确选择无痕打开，但后续导航不受插件控制。可选强制要求无痕授权（改变已确认的行为）或继续现状并明确提示。当前不改变业务逻辑。
- R04：主文档网络请求不能覆盖所有 SPA、缓存、Service Worker、特殊协议等；POST 重放、复杂登录/下载、不同扩展规则竞争需实机验证。不是防火墙或恶意网站检测器。
- R05：网页内悬浮备注可被网页遮挡或仿冒，身份确认优先看浏览器原生扩展弹窗，备注中不要存秘密。
- R06：导航循环阈值为同标签30秒内同 URL 第3次或累计第13次暂停自动打开；不是跨后台重启的持久安全限制。不同标签互相独立，手动确认可继续；无扩大授权。建议保留内存设计以保护隐私。
- R08/R09：建议限制 tag push 和仓库写权限、启用可用的 secret scanning、核验 Git 历史并完成实际 Actions。已有 v1.0.2 标签不得强制移动，需单独决定发布策略。

## 8. 测试与发布门槛

基线 16/16 Node 测试脚本通过；修订后 16/16 通过，新增故障注入包含在既有 confirm-integration.js。全部 27 个 JS 文件语法检查通过。测试覆盖 Teams、普通导航不抢占、名单与范围、无痕 API、悬浮备注、消息权限、临时授权、存储故障、循环识别、导入导出及 CI 静态校验。详见 TEST_RESULTS_1.0.2.txt。本地构建依照 workflow 的 Git archive 清单，另行验证 ZIP；没有调用 gh release create。

本环境读取到 Chromium 管理策略 ExtensionInstallBlocklist=["*"]、IncognitoModeAvailability=1、URLBlocklist=["*"]，因此未尝试绕过策略进行真实浏览器安装。Google 九宫格、Drive、Gmail、Gemini、Teams/TIM、多 Profile、真实 DNR 规则序列化、无痕、循环暂停及所有 UI 操作的修订版联调仍待确认。用户此前实测 NavigationFix 正常，不代表最新 .9 实机测试已通过。

发布建议：D01 已批准并升级；核查远程 Git 历史；再实机复验，最后触发 GitHub Actions。没有推送、没有移动标签、没有增加浏览器权限或第三方运行依赖。
