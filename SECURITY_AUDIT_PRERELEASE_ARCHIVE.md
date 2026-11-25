# LinkEntryGuard 1.0.2 发布前功能验收与安全审计

- 审计日期：2026-11-25；产品版本：1.0.2；交付构建：`1.0.2-r20261125.2`。
- 审计基线：实际解包的 `LinkEntryGuard_1.0.2_Experience.zip`（51 个文件，不含目录项）；未使用过去的审核结论代替源码。
- 审核方式：源码及配置审查、依赖公告检索、敏感凭据模式扫描、浏览器 API 文档核对、原有测试与新增故障注入、实际本地 Git 打包、Chromium 启动尝试。
- 结论：可以提交源码至 GitHub 进行候选发布；尚不能认定真实浏览器完整验收通过。涉及授权边界的剩余风险请在发布前阅读。未修改用户本地 Git 仓库或远程仓库。
- 严重度为项目自身安全策略的定性评级，不是 CVSS，也不代表已分配 CVE。表内位置均指修复后源码行号或函数。

## 1. 项目概况与依赖审核

原生 JavaScript、HTML、CSS、JSON，Chrome Manifest V3，声明最低 Chrome 116。运行时第三方依赖 0；本项目无 package.json、npm/pnpm/yarn 锁文件、Python/Go/Rust/Java 等依赖清单，无 npm 构建或远程加载模块。Node 内置 `assert/fs/path/vm/crypto` 等仅用于测试，未打进安装包。

| 类型 | 依赖及实际版本 | 处理 |
|---|---|---|
| CI Action（唯一直接外部 Action） | 原 `actions/checkout` v4.2.2，`11bd71901bbe5b1630ceea73d27597364c9af683` | 同大版本更新至 v4.4.0，`11d5960a326750d5838078e36cf38b85af677262`，两处使用相同完整 SHA |
| CI 工具 | GitHub 托管 ubuntu-24.04 runner 提供 Node、Git、gh、unzip、sha256sum | 实际远程镜像及工具版本待 Actions 运行确认；本地 gh 不存在，不执行发布 |
| 测试环境 | Node v22.16.0、Chromium 144.0.7559.96；Python/YAML 等用于审计而非插件依赖 | 仅说明本次工具环境，不视为最终用户推荐安全版本；使用持续支持且更新至安全补丁的运行环境 |
| 间接依赖 | 项目无锁文件、无 vendor 库 | checkout 自身分发包及其内部依赖不在源码包，待独立 SBOM/上游审计；不编造实际版本 |

2026-11-25 检索 GitHub Advisory Database、OSV、NVD、checkout 官方 release/changelog/security：未检出能明确证明本工作流使用的 checkout 版本存在适用 Critical/High 漏洞的条目；部分 GitHub 精确查询页面抓取受限，不能据此宣称无漏洞。已查明 v4.4.0 具有针对不安全 fork PR checkout 的加固回移；本项目只在版本标签 push 时运行，不使用 `pull_request_target` 或 `workflow_run`，原来即关闭凭据持久化，因此相关场景不直接适用。v4.4.0 仍有官方发布记录，非停止维护的明确证据；不擅自跨大版本升级。未发现仿冒包。npm audit 等包管理器扫描不适用（无清单/锁）；不为生成扫描结果而临时引入 npm 依赖。GitHub Actions 原始上游包完整依赖清单、私有仓库 Dependabot 告警与实际 runner 软件版本待确认。

核对来源（均为公开资料，检索日期同上）：

- https://github.com/actions/checkout/releases （v4.4.0 官方发布及变化）
- https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262 （官方提交）
- https://github.com/actions/checkout/security
- https://github.com/advisories/ 、https://osv.dev/ 、https://nvd.nist.gov/
- https://docs.github.com/en/actions/reference/security/secure-use （最小权限、固定 SHA、可信触发）
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest/ （规则优先级、RE2、会话规则、缓存/SW 边界）
- https://developer.chrome.com/docs/extensions/reference/api/windows （无痕窗口创建）
- https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea （可信上下文）
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle/ （后台休眠及恢复）

## 2. 功能验收矩阵（先验收，再修复）

原有 15 个测试脚本在未改基线已全部成功。最终 16 个测试脚本通过；下表“模拟通过”指真实源文件在 Node 中执行浏览器 API/DOM 事件模型，不代表 Chrome 本身已验证。实际测试 Chromium 受既有管理策略约束（ExtensionInstallBlocklist=*、IncognitoModeAvailability=1、URLBlocklist=*）；没有修改或绕过这些策略。

| 功能 | 源码/测试证据 | 结果及边界 |
|---|---|---|
| 外部软件、地址栏主文档导航 | background.js、rules/failsafe.json、confirm-integration | DNR 规则生成/优先级模拟通过；实际外部 Teams/TIM 请求待确认 |
| Teams 网页点击保护 | teams-guard.js、teams-events | 左键、组合键、中键、键盘、拖动链接与 data-href 测试通过；真实 Teams DOM 待确认 |
| GPT 等正常站内切换 | page-click-guard.js、page-click-events | 同源 SPA 链接不强制确认；实际网络主文档导航仍确认；真实 GPT 待确认 |
| 普通打开/取消/无痕打开 | confirm.js、confirm-integration、confirm-page | 两种无痕权限场景、拒绝策略、过期确认、撤销失败模拟通过；实际窗口创建待确认 |
| 黑名单/白名单/未分类 | policy.js、background.js、list-quick-events、confirm-integration | 黑优先、白自动单次授权、未分类人工确认；规则读取失败不放行 |
| 精确、目录、整站规则 | policy.js、list-tools | 大小写、协议、域名、端口、目录尾斜杠、特殊字符与相似域名覆盖；不提供子域通配 |
| 确认页/弹窗快捷加入、转换、移除、备注 | list-quick.js、ui-composed、list-quick-events | 快照冲突、焦点事件、按钮状态、读取失败后重试模拟通过 |
| 集中管理、搜索、多选、批量转黑/白、移除 | lists.js、lists-manager-events | 测试通过；实际交互与大量名单性能待确认 |
| 导入、导出、预览、撤销 | list-tools.js、lists.js、lists-manager-events | JSON 格式/体积/数量/重复校验，冲突保留原名单；备份只恢复上一快照，真实文件选择/下载待确认 |
| 右键管理与规则测试 | background.js、lists.js、confirm-integration | 临时令牌一次消费、不访问目标、无效协议拒绝模拟通过；Chrome 右键 UI 待确认 |
| 悬浮备注与开关 | floating-label.js、always-visible、floating-label-events、popup-events | 30px 标签、编辑、失焦、拖动贴边、取消捕获、重置、DOM 重建恢复模拟通过；实际位置待确认 |
| 各 Profile 数据独立 | storage.local、无 sync 使用、后台设置串行 | 源码支持独立存储，同 Profile 多窗口共享；两真实 Profile 隔离需实机验证 |
| 日志及脱敏诊断 | background.js、popup.js、privacy-failure | 日志只记主机名与固定原因，诊断不含完整 URL/备注；异常状态与恢复测试通过 |
| 旧版升级、构建不一致 | ui-transport.js、ui-composed、confirm-integration | 保持原存储键，失败时不清空名单，模拟覆盖旧构建；实际同路径升级待确认 |
| GitHub 自动发布 | .github/workflows/release.yml、release-safety | 版本检查、测试、文件白名单、实际 Git archive 本地执行通过；远程发布待确认 |

### 必须纠正的产品表述

- 黑名单只控制受扩展影响的主页面访问，不是防火墙；不撤销已加载网页、网页子资源或其他程序网络连接。
- 白名单仍走单次受控授权，可能看到短暂确认页。Teams 网页的直接点击保护继续优先，不会因白名单自动允许该 DOM 点击。
- 无痕未授权扩展时，仅打开动作受当前名单检查；无痕窗口内后续访问不受保护。
- 悬浮备注不能覆盖 Chrome 原生 UI、内部页和部分特权页面；图标悬停提示为替代，不是真正全屏悬浮。

## 3. 问题汇总及逐项修复

| 编号 | 类别 | 严重级别 | 位置（修复后） | 状态 |
|---|---|---|---|---|
| A01 | 代码 | High | background.js:388–468（emergencyRule/setEmergencyBlock/clearGrant/cleanupExpired） | 已修复：增加紧急阻断；平台 API 双重失败风险见 R02 |
| A02 | 代码 | Medium | background.js:308–326、434–468 | 已修复：校验残留及被改动的动态/会话规则 |
| A03 | 代码 | Medium | background.js:184–245、471–522、605–696 | 已修复：过期确认及异步导航竞争 |
| A04 | 代码 | Low | confirm.js:6–8、30–37、65–67；list-quick.js:78、101 | 已修复：嵌入页操作与 hash 更新 |
| A05 | 代码 | Medium | background.js:41–55、69–77、710–714 | 已修复：隔离失败时不读取/写入设置，不返回历史 |
| A06 | 代码 | Low | teams-guard.js:81 | 已修复：异步消息拒绝处理 |
| A07 | 代码 | Low | popup.js:33–42 | 已修复：迟到保存响应覆盖新草稿 |
| A08 | 代码/CI | Medium | .github/workflows/release.yml:8–46 | 已修复：测试只读，发布单独写权限 |
| A09 | 依赖 | Low | .github/workflows/release.yml:21、49 | 已修复：checkout v4.2.2 → v4.4.0，完整 SHA |
| A10 | 代码/CI | Medium | .github/workflows/release.yml:51–66 | 已修复：从已提交文件按明确允许清单打包 |
| A11 | 密钥/隐私 | Low | .gitignore:15–22 | 已修复：排除常见本地凭据、导出名单及生成目录 |

### A01：撤销失败时仅显示 ERR，残留 allow 仍可能生效

原实现即使保留待撤销状态，Chrome 的请求管线仍会使用未删除的会话规则。触发条件：授权后会话规则删除失败、用户或程序在有效标签内重复访问同一匹配 URL；可能无需再次确认。该项目控制的是误开链接，定为 High（产品保护失效，不是系统代码执行）。修复：尝试安装高于正常 allow（100）和黑名单 redirect（200）的独立动态 block（1000）；只有成功核验会话规则清理后才能撤销紧急阻断。后台重启不会因为一般规则清理而先删掉该保护。新增测试注入撤销失败、验证阻断优先级、恢复后撤销紧急规则。若 Chrome 同时拒绝紧急规则安装，仍无法保证阻止请求，ERR 和日志明确提示；见 R02。

### A02：规则健康检查未涵盖未知 ID 与临时规则内容

原来只清理高编号孤立授权，其他未知规则及活跃授权内容错误可能未被识别。需要已有规则异常、旧版本迁移或扩展自身状态损坏；不表示普通网页可以直接修改 DNR。修复：动态规则只接受全局、紧急及本名单保留区间；会话规则只接受已追踪且结构吻合的授权，未知 ID、被篡改或缺失的规则清理后重新检查。新增低编号未知规则和改变授权优先级测试。

### A03：异步批准或名单编辑可能作用于已改变的确认标签

触发条件：用户批准、编辑名单后，在规则查询或安装期间改变标签地址/待导航地址；旧操作可能覆盖新页面，或向过期目标放行。修复：在队列内、安装规则前后及实际导航前检查 `tab.url` / `pendingUrl`，失败撤销刚创建的授权；确认页名单修改在同步规则、存储前复核来源；无痕转交后仅清理仍是原确认页的标签。测试注入安装授权期间切换 pendingUrl，拒绝旧请求且不遗留规则。跨浏览器 API 无事务，仍存在极短的最终检查与操作间隙（R02）。

### A04：可嵌入确认页取消操作及 fragment 更新

确认页为 DNR 所需 web accessible resource，外部站点可尝试嵌入。后台原本拒绝 iframe 放行，但取消及快捷入口未统一限制；同一确认文档的 fragment 更新也可能使显示内容与目标不一致。修复：嵌入页禁止访问/取消及快捷名单管理；顶层 hash 改变时锁定按钮并重新加载；打开前核对目标。新增嵌入和 hash 更新测试。

### A05：隐私隔离失败时设置/日志读取路径不统一

Chrome 默认 local storage 对 content script 可见；若 setAccessLevel 失败，原 readUi/saveUi 仍可继续访问浏览器备注，弹窗状态还可能读取旧日志。普通网页不是天然可调用扩展 API，风险需要扩展内容脚本被滥用或隔离失败。修复：读取/保存设置要求隔离成功，失败时拒绝返回日志；原有日志清理、名单读写 fail-closed 行为保留。不得擅自删除已有名单或备注。见 R03 关于存储并非加密保管库的边界。

### A06：Teams 内容脚本发送消息 Promise 拒绝未被接住

触发条件：扩展重新加载、后台不响应。原同步 try/catch 无法捕获异步拒绝。补充 Promise catch，仍在网页侧阻止点击，不让日志失败改变拦截。

### A07：备注保存响应覆盖后续输入

用户在保存旧备注尚未返回时输入新备注，返回值可能覆盖新草稿。只在当前内容仍为当时提交值时回填成功值或恢复旧值。新增延迟响应测试。

### A08–A10：CI 权限、依赖与发布内容

旧工作流全部步骤（包括源码测试）有 contents:write；若未来测试/依赖遭篡改可扩大影响。将验证 job 单独设为只读，发布 job 依赖验证成功；两次 checkout 固定同一事件 SHA、关闭持久化凭据；标签格式/manifest 版本必须一致，重复执行不会强制覆盖已有 Release。更新 checkout 同主版本安全加固版本（见第 1 节）。发布从 Git 已跟踪的明确文件清单生成 ZIP，不再用宽泛通配符打包目录，避免误夹带新文件或本地导出。CI 不使用不可信 PR 触发，不把 GitHub 表达式直接插入 shell 命令，变量均引号保护。验证 job 运行所有测试和 JS 语法检查，发布 job 不执行项目 JS；发布 token 仍有创建 Release 所需写权限。新增 release-safety 静态回归测试，检查所有 manifest/HTML 引用资源存在且为普通文件。

### A11：本地名单导出和常见凭据缺少 Git 忽略

`LinkEntryGuard-lists.json` 含完整网址、备注，可能存在敏感参数；若用户把导出放入项目目录后 git add -A 可能误提交。新增导出文件、dist、.npmrc、.netrc、.git-credentials、keystore 忽略项；保留原 .env、证书密钥忽略规则。忽略规则不能清除已被 Git 跟踪的文件。

## 4. 逐文件/攻击面审查

| 文件/范围 | 检查结果 |
|---|---|
| manifest.json | MV3，无 externally_connectable、无任意脚本注入权限、无远程代码配置；HTTP/HTTPS 主机权限与 tabs/storage/DNR/webNavigation/alarms/contextMenus 均有对应功能。全站权限仍是产品必要的广泛权限；Chrome 内部页没有新增权限。 |
| background.js | 来源 ID、顶层 frame、扩展 URL、目标绑定、名单权限、快照、存储隔离、规则完整性和临时授权等见 A01–A05、R02。无外部 HTTP 客户端、无 eval、无 shell、无数据库；不记录原始 API 错误或 URL 查询参数。 |
| policy.js:31–55 | 仅 HTTP/HTTPS、拒绝 URL 内凭据、限制长度，规则匹配使用 URL 解析与转义后 RE2；无用户正则直接执行。目录须明确斜杠、同源匹配，黑名单优先。 |
| rules/failsafe.json | 静态 main_frame block 优先级 1，动态确认 10、临时授权 100、黑名单 200、故障紧急阻断 1000；同扩展规则优先级关系正确。实际 Chrome 生效待确认。 |
| confirm.html/css/js、list-quick.js | 本地脚本与样式，无外部资源；文本通过 textContent，来源/顶层/目标约束；确认 URL fragment 隐私仍见 R03。 |
| popup.html/css/js、ui-transport.js | 本地 UI、构建一致性、错误码、读取重试、写入不自动重放；异步草稿处理见 A07；无远程执行。 |
| lists.html/css/js、list-tools.js | JSON 解析无代码执行，2 MB/300 条/URL 长度校验，导入预览、旧快照、规则冲突处理；文本安全渲染；导出为本地 JSON Blob，未接收 ZIP 文件。 |
| floating-label.js | Closed shadow root，真实双击/键盘/指针事件，坐标验证、重建频率限制；网站仍可遮挡宿主节点，不能作为可信安全标志（R05）。 |
| page-click-guard.js、teams-guard.js | 内容脚本限定域/协议与事件，普通网页同源切换保留；网页事件无法覆盖所有程序化导航，DNR 是主要保护，未将 DOM 点击监听冒充网络隔离。 |
| icons/*.png、icons/incognito.svg、所有 CSS | 本地资源；SVG 无远程脚本，CSS 无远程 import；未发现可执行外链。 |
| tests/*.js（16） | Node 内置模块，模拟数据及故障注入，不包含真实账号；测试不进入发布 ZIP。 |
| .github/workflows/release.yml、.gitignore | A08–A11；无 PR 高权限触发、无未固定版本 Action、无硬编码 Token。 |
| README、CHANGELOG、历史报告及记录 | 检查敏感信息与版本表述；历史报告保留为档案，当前结论以本文件为准。 |

其他要求：SQL/NoSQL 注入、服务端 SSRF/CORS/CSRF、数据库鉴权、系统命令注入、桌面 IPC、Electron nodeIntegration、移动 WebView、上传解压 Zip Slip、TLS 校验关闭、自造加密、硬编码 IV/盐：本扩展无对应服务端/数据库/桌面/移动组件或代码路径。URL 导航和扩展消息授权是相关的实际攻击面，不能以“不适用”替代上述审查。第三方网站和 Chrome 本身的漏洞不在本项目源码修复范围内。

## 5. 密钥与凭据审查

对源码、配置、测试、文档、历史报告及图像/安装文件进行常见密钥格式模式扫描（GitHub token、云 access key、API key、SSH/PEM 私钥、Slack/Discord webhook、数据库 URI 等）及关键词人工核查。未发现实际硬编码凭据；测试用 `?token=TEST`/`?token=SECRET` 为测试数据，`GH_TOKEN: ${{ github.token }}` 是运行时 GitHub 临时凭据引用而非明文密钥。无 .env 实体文件，不需要虚构 .env.example；已核对 .gitignore。源码包没有 .git 历史、远程秘密配置或用户浏览器数据，因此是否曾提交或泄露密钥、是否存在已跟踪忽略文件，待开发者在真实仓库检查。若发现已提交或泄露的凭据，必须在原平台撤销并重新生成，仅删除代码不够；需审查旧 Release 资产和历史提交。不要把名单导出、完整登录链接或浏览器 Profile 上传 GitHub。

## 6. 剩余风险及待开发者决定

| 编号 | 类别/严重级别 | 位置 | 风险与选择 | 状态 |
|---|---|---|---|---|
| R01 | 代码 / Medium | page-click-guard.js:8–25；background.js:747–757；manifest.json | DNR 仅覆盖到达网络栈的主文档请求；SW CacheStorage、非网络 SPA、下载、非 HTTP(S)、已加载页面存在边界。A 保留现行为并准确宣传；B 扩大到更严的网页/系统级控制（会影响正常浏览）。建议 A。 | 待开发者决定/实机确认 |
| R02 | 代码 / Medium | background.js:388–522 | 单次授权是标签+精确网址+限时，不是原子的一次网络请求；25 秒 TTL，后台休眠/重复请求、API 双重失败、极短 TOCTOU 均不能保证完全消除。A 保持现有受控授权及紧急阻断；B 改架构/采用系统级入口，成本高。建议 A，不宣称绝对隔离。 | 待开发者决定 |
| R03 | 隐私 / Medium | background.js:30、258–268、147–149；lists.js 导出、storage.local | 确认 URL fragment、完整名单/上一份备份/导出文件可能包含登录 token；本地存储不是加密保险箱。右键预填已采用一次性令牌，DNR 直接重定向的原始目标仍无法无条件令牌化。A 保留并提示；B 重构确认 URL 传递与备份保留策略。建议先不在名单保存敏感 URL。 | 待开发者决定 |
| R04 | 代码 / Medium | background.js:605–657；confirm.js | 无痕未授权运行时，其后续导航不受控制；POST 表单重放及跨站 OAuth 重定向可能中断/再次确认。A 保留逐次确认；B 对特定经过验证的重定向链放行、要求无痕授权（改业务行为）。建议 A，先做真实登录测试。 | 待开发者决定 |
| R05 | 代码 / Low | floating-label.js、manifest.json | 网页可遮挡/移除标签，原生 Chrome 页面不能注入；主机权限可见所有 HTTP/S 页面。A 保留可见提示，最小化内容脚本；B 缩小权限或用系统级方案（影响全站保护）。建议 A。 | 建议关注 |
| R06 | CI / Medium | .github/workflows/release.yml | tag 权限、分支保护、GitHub Actions 真实 runner、仓库历史和 token 权限未实测；恶意可信提交或可移动标签仍有供应链风险。建议限制 v* 标签创建/更新权限，开启 secret scanning、Dependabot，审阅已有标签而不 force push。 | 待确认 |

本轮不增加自动无痕名单、自动放宽登录跳转、子域通配或全局保护关闭按钮，不删除原功能，不迁移名单数据格式，不擅自大版本升级或轮换凭据。源代码中未发现已确认 Critical 漏洞；A01 高级别保护风险已加固，剩余不可原子控制的 Chrome 限制不应被描述为全部解决。

## 7. 测试、交付及发布门槛

- 原有 15 组基线测试、修复后的 16 组测试（含 `release-safety.js`）全部通过；新增断言覆盖撤销失败紧急阻断、未知/修改规则、过期确认、嵌入页及 hash 更新、旧备注响应和发布文件清单。
- JS/JSON/YAML/Bash 语法、ZIP 完整性、Git 文件清单和构建版本核对见 `TEST_RESULTS_1.0.2.txt`。
- 真实 Chromium 144 启动后访问本地测试页返回 `ERR_BLOCKED_BY_ADMINISTRATOR`，未观察到扩展 worker；管理策略也禁用无痕。真实 Chrome、Teams/TIM、多个 Profile、OAuth/POST/重定向、DNR 真正匹配及紧急规则恢复、GitHub Actions 远程执行均为待确认。未绕过策略、未使用模拟结果冒充实机结果。
- 交付完整源码包（含 .github、测试和本报告），另提供按 CI 清单构建的本地安装 ZIP 用于试装。上传 GitHub 应使用完整源码包，不要只提交安装包。
- 发布前建议至少验收：外部点击普通/无痕/取消、黑名单覆盖白名单、登录及 GPT 切换、导入导出及撤销、跨 Profile、更新保留数据、紧急恢复状态。先在测试 Profile 重新加载，不卸载原扩展。版本标签尚不存在时，提交 main 后创建 v1.0.2 并推送；如果标签已存在，不强制重写，须先明确如何处理既有 Release。
