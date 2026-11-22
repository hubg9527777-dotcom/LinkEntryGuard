# LinkEntryGuard 1.0.1 — 功能复核与完整安全审核报告

**审核日期：** 2026-11-21（项目当次会话日期，打包环境日期可能不同）  
**审核对象：** 上一轮已交付的 `LinkEntryGuard_1.0.0_DragBoundaryReset.zip`，本次复制并修订后的全部源码。**不是用户 Mac 本地仓库的实时镜像，也不是 GitHub 在线分支。**  
**交付版本：** `manifest.json` = **1.0.1**；不自动执行 Git 提交或 GitHub 推送。  
**审计方法：** 逐文件源代码审查、权限/攻击面审查、规则匹配审查、敏感信息检索、官方 Chrome 文档核对、Node.js 事件/故障模拟测试、Chromium 启动尝试。  
**验收级别：** 静态审计 + 本地模拟测试通过；真实 Chrome + Teams/TIM + 无痕及 Chrome 内部页面联调**待确认**。

## 1. 项目概况、依赖与范围

| 项目 | 结果 |
|---|---|
| 应用类型 | Chrome Manifest V3 浏览器扩展，无服务端、无数据库 |
| 语言、框架 | 原生 JavaScript、HTML、CSS、JSON，本地 PNG 和 SVG；无第三方框架 |
| 依赖清单 | **直接依赖 0**；无 `package.json` / lockfile / `requirements.txt` / `go.mod` / `Cargo.toml` / `pom.xml` / `Podfile` |
| 间接依赖 | **0**（不存在包管理器锁文件） |
| 实际运行平台 | Chrome `minimum_chrome_version: 116`（平台最低版本声明，不是第三方库） |
| 功能范围 | DNR 请求前确认、Teams 网页点击拦截、普通/无痕打开、悬浮备注、Profile 本地设置、操作日志 |
| 审核文件 | `manifest.json`, `background.js`, `confirm.*`, `popup.*`, `floating-label.js`, `page-click-guard.js`, `teams-guard.js`, `policy.js`, `rules/failsafe.json`, `.gitignore`, `icons/*`, `tests/*`, 说明与审核文档 |
| CI/CD | 当前源码包无 `.github/workflows`，不代表远端仓库不存在额外工作流 |

**依赖漏洞审查：** 没有第三方软件包可逐个列出或在 GHSA / OSV / NVD 中按包名核对；`npm audit`、`pip-audit` 等对本项目**不适用**，不能声称“执行后零漏洞”。浏览器自身 Chrome 安全更新不由扩展的锁文件控制，建议持续使用受支持的 Chrome 版本。未发现可判定为停止维护或疑似拼写仿冒的依赖，因为不存在这类依赖。

## 2. 本轮问题汇总

严重程度根据当前可见的利用条件评估，并非 CVSS 精确打分。以下行号指**本次修复后的 1.0.1 源码**。

| 编号 | 类别 | 严重级别 | 位置 | 风险/触发条件 | 状态 |
|---|---|---|---|---|---|
| LEG-101-01 | 代码/功能 | Medium | `manifest.json:57-77`; `confirm.html:16-17`; `floating-label.js:1-3` | 悬浮标签只注入普通网页，进入扩展自身确认页时消失；在多 Profile 使用时可能忘记当前浏览器身份 | **已修复**：确认页载入同一悬浮组件 |
| LEG-101-02 | 代码/可用性 | Low | `background.js:15-16,53-63` | 新安装默认关闭悬浮，与“默认显示、有需要再关闭”目标不一致 | **已修复**：新 Profile 默认显示；原有 `show=false` 保留 |
| LEG-101-03 | 代码/状态 | Low | `background.js:64-74,199-210,493-497` | 修改备注后自有确认页和浏览器限制页无法及时辨认 Profile | **已修复**：扩展页广播 + 工具栏图标悬停提示，异常不影响规则 |
| LEG-101-04 | 代码/可用性 | Medium | `floating-label.js:145-176` | SPA 更换根元素/删除 DOM 直接子节点会令悬浮条消失 | **已修复（尽力恢复）**：轻量观察器重新挂载，限制 10 秒内最多 12 次防止恶意页面无限移除造成 CPU 负担 |
| LEG-101-05 | 代码/状态 | Low | `floating-label.js:42-48,178-182` | UI 广播带有不合法坐标时旧前端可能回退默认位置，形成误跳动 | **已修复**：广播数据独立严格校验；真正鼠标拖动仍可越界贴边 |
| LEG-101-06 | 代码/兼容 | Low | `floating-label.js:3`; `background.js:64-74` | 以前即使授权无痕访问也主动跳过悬浮标签 | **已修复**：已授权的无痕普通网页允许显示，同 Profile 同步备注；未授权无法注入 |
| LEG-D01 | 代码/隐私 | Medium | `background.js:20,118-126`; `confirm.js:7-24` | 完整目标 URL 写入确认页 fragment；带有令牌、凭据、敏感查询参数的链接可能留在本机历史/截图中 | **待开发者决定**：隐私架构变更 |
| LEG-D02 | 代码/授权 | Medium | `background.js:242-313,436-447,473-489` | 25 秒精确临时 allow 规则并非原子的单次网络请求授权；工作线程中断/撤销失败可能延迟撤销 | **待开发者决定**：更严格状态机或系统级方案 |
| LEG-D03 | 代码/兼容 | Medium | `manifest.json:47-90`; `rules/failsafe.json:1-15` | HTTP(S) 主文档之外的 SPA 状态变更、特殊协议、Service Worker/缓存路径不能确保全部被请求前拦截 | **建议关注**；完全覆盖会改变浏览行为 |
| LEG-D04 | 代码/兼容 | Medium | `background.js:286-313,436-447` | 已拦截的 POST 表单无法由普通 `tabs.update({url})` 重放表单请求体，可能干扰提交/登录 | **待开发者决定**：兼容性与拦截严格度取舍 |
| LEG-W01 | 代码/权限 | Medium | `manifest.json:8-14,47-90` | 所有 HTTP(S) host 权限具有宽广影响范围，一旦扩展遭入侵可能读取/影响众多网页 | **建议关注**；现有全站保护需求下无法无代价缩小 |
| LEG-W02 | UI/防伪 | Low | `floating-label.js:6-35,145-176` | 标签位于页面 DOM，可被恶意网站遮挡/仿造，恢复机制不能保证对抗持续破坏 | **建议关注**；不能当作系统级防伪 UI |
| LEG-W03 | 日志/隐私 | Low | `background.js:102-116`; `popup.js:39-75` | 本机存储访问域名和时间，域名本身可能包含隐私信息 | **建议关注**；上限 100 条，可手动清除 |
| LEG-W04 | 密钥/CI | Low | `.gitignore:1-12`；整个交付目录 | 当前文件未发现实际密钥；但缺少本机 `.git` 历史和远端 Actions，无法证明历史未泄露过密钥 | **待确认** |
| LEG-W05 | 平台限制 | Medium | `manifest.json:47-77`; Chrome 扩展安全模型 | `chrome://`、原生新标签页、Chrome Web Store、PDF 查看器、其他扩展页及原生书签栏不能被普通内容脚本覆盖 | **待开发者决定**：不擅自替换新标签页或要求系统常驻程序 |
| LEG-W06 | 无痕权限 | Medium | `background.js:358-436`; `floating-label.js:1-3` | 未授权“允许在无痕模式下运行”时可尝试创建无痕窗口，但后续无痕网页不会继续受该扩展监测/显示备注 | **建议关注**；权限必须由用户明确授予 |

**未发现可确认的 Critical / High 级新漏洞。** 上表的 Medium/Low 项仍不能等同于“安全性已经全面验证”。

## 3. 已实施的修改——内容、原因、兼容性

1. **统一悬浮组件覆盖**：`confirm.html` 引入本地 `floating-label.js`；`confirm.js:19-27` 避免启用悬浮时重复展示同一备注胶囊。确认页由扩展自身加载本地脚本，不新增 `web_accessible_resources`，不扩大内容脚本匹配范围。
2. **新 Profile 默认开启**：`background.js:16,53-63` 从首次安装默认隐藏调整为默认显示。已保存的 Profile `show=false` 仍尊重用户选择；关闭只影响悬浮条，不关闭链接保护。
3. **自有扩展页实时同步**：`background.js:64-74` 向内容脚本和本扩展页面发更新通知；只向当前 Profile 的已连接扩展上下文广播，没有新增跨扩展对外通信权限。
4. **Chrome 原生 UI 最小退路**：`background.js:199-210,493-497` 将备注写进原生扩展图标的 tooltip，供无法注入悬浮条的页面鼠标悬停查看。`setTitle()` 失败会安全忽略，不影响设置保存或 DNR 保护规则。
5. **无痕页面覆盖**：`floating-label.js:1-3` 不再无条件排除无痕。只有用户在 Chrome 设置中允许该扩展无痕运行，内容脚本才能显示；不自动提升权限。
6. **DOM 自恢复**：`floating-label.js:145-176` 监测根元素/直接子节点变化重新挂载，不遍历 GPT 等大型 SPA 每次内部 DOM 变化；增加 10 秒最多 12 次的防滥用限制。
7. **边界与状态校验分离**：`floating-label.js:42-58,178-182` 保存/同步坐标要求非负整数且不超过 8192；拖动时临时负数仍会被贴边计算，不会再次出现越界回默认。
8. **界面说明与版本更新**：`popup.html:6` 删除“仅普通网页显示”的过时描述；`manifest.json:6` 与测试断言统一 `1.0.1`；README 增加无法覆盖区域的准确说明。

**刻意没有改变：** Teams 直接点击阻止策略、DNR 主规则、25 秒放行、直接/无痕/取消三个按钮、拖动手势及点击空白处保存、Profile 分离、权限清单。没有调用远程 GitHub，也没有新增第三方包。

## 4. 需要开发者决定的取舍（未擅自修改）

| 问题 | 选项 | 建议 |
|---|---|---|
| 真正所有界面显示 | A. 现有普通网页/确认页悬浮 + 原生工具栏 tooltip；B. 使用 `chrome_url_overrides.newtab` 替换浏览器新标签页；C. 安装系统级覆盖层 | **推荐 A**；B 改变 Chrome 新标签功能仍不能覆盖设置/工具栏，C 增加软件复杂度 |
| 敏感 URL 在 fragment | A. 保留当前 DNR 重定向；B. 重新设计目标令牌传递架构 | **先维持 A**，如需处理含敏感 token 的链接再单独评审 B |
| 临时放行严格度 | A. 现有精准 URL + tab ID + 25 秒 + 清理重试；B. 复杂状态机或系统级链接入口拦截 | **先维持 A**，不要宣传严格原子的一次请求授权 |
| POST / 全协议导航 | A. HTTP(S) GET 风格主导航优先；B. 处理全部表单/程序化跳转并允许兼容性变化 | **先维持 A**，遇真实问题再按案例设计 |
| `file://` 本地页面 | A. 不请求读取本地文件权限；B. 在 `manifest.json` 添加 file 匹配，要求用户另行开启“允许访问文件网址” | **推荐 A**，不为显示标签而额外取得敏感本地文件访问权限 |

## 5. 逐类安全审查

**注入/XSS：** 用户备注和 URL 渲染使用 `textContent`；未发现动态执行代码、`innerHTML` 拼接不可信输入、远程加载 JS。SVG 为本地静态路径绘制。确认页背景核查 `sender.id`、frame、tab、URL 严格对应，不允许普通网页任意授权 URL。既有临时 URL 规则使用转义和大小写敏感匹配。

**权限与消息**：`manifest.json` 包含 `tabs`、`storage`、`declarativeNetRequest`、`webNavigation`、`alarms`；HTTP(S) 全域为全站行为所需。未配置 `externally_connectable`、`scripting`、远程代码或额外原生消息主机。只允许有效来源查看/修改相应 UI，只有扩展确认页可请求放行；日志接口限定为插件弹窗。

**存储和日志：** `chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})` 失败时关闭持久日志写入，避免敏感历史通过内容脚本读取；事件仅保存主机名及时间/原因。备注每 Profile 本地保存，非加密机密存储，不要填写密码或敏感凭据。保存合并有串行队列。

**密钥扫描：** 全文本搜索 hardcoded API Key/Token/密码/私钥/连接串/Webhook、证书等，未发现实际秘密；`.gitignore` 忽略 `.env`、key/pem/pfx/p12 等常见敏感文件。未发现需要迁移到环境变量的实际密钥，故**不生成无意义的 `.env.example`**。如果秘密曾在 Git 历史或公开版本泄露，必须到原服务吊销并重新生成，光删当前代码不够。

**不适用类别：** 无数据库/SQL/NoSQL、系统命令执行、文件上传解压、加密实现、服务端 CSRF/CORS、Electron IPC、移动端 WebView、自定义反序列化、TLS 校验关闭。URL 跨域导航属于插件的显式用户确认动作，不是将任意 URL 传给服务器抓取的 SSRF。

**CI/CD：** 当前源码包没有 `.github/workflows`、`pull_request_target`、第三方 Actions 或脚本注入点；由于缺 Git 远端上下文，远端工作流风险**待确认**。

## 6. 测试和结果

| 项目 | 结果 |
|---|---|
| 10 组 Node 自动化模拟（原有 9 + 新增 `always-visible.js`） | **10/10 通过** |
| `node --check` 所有 JavaScript | 通过 |
| `manifest.json`、`rules/failsafe.json` 解析 | 通过 |
| 默认显示、已有偏好保留、备注/开关并发保存 | 通过（模拟） |
| 扩展确认页同组件、已授权无痕上下文、重挂载和非法位置广播 | 通过（模拟） |
| 点击确认/无痕/取消、异常放行规则、Teams 点击、SPA 兼容 | 通过（模拟） |
| 本地密钥/危险 API/远程代码检索 | 未发现真实密钥或不安全动态加载 |
| Chromium headless 加载真实扩展和本地 HTTP 测试 | **未完成**：启动后超时，没有取得 DOM 或后台可验证状态；不能算通过 |
| Mac/Windows Chrome 全流程实机测试 | **待确认** |

### 用户设备上建议重点核查

1. **更新旧 Profile**：升级后如果原先关闭过悬浮，弹窗开关仍保持关闭；开启后在 Google/GPT 等网页及插件确认页应看到同一备注；关闭时都应隐藏小条。
2. **确认页**：点击 Teams/TIM 链接，在确认页面能看到可移动的备注。不要把 Chrome `chrome://` 设置页当作同等级测试对象。
3. **拖动**：靠近书签栏不会跳回默认，双击修改、点击空白处保存、重启浏览器位置仍保持；“重置位置”只在点击时生效。
4. **无痕**：如果允许扩展无痕运行，无痕网页也有备注；未允许时仍可按既有流程请求创建无痕窗口，但无痕内不继续注入。
5. **其他 Profile**：同一份源码在两个独立 Chrome Profile 中分别保存不同备注，互不覆盖。
6. **拦截安全**：正常直接打开、无痕打开、取消；同一 URL 第二次必须重新确认，不能永久放行；GPT 同源聊天切换不被网页点击脚本过度拦截。

## 7. 官方资料（不使用中国大陆来源）

- Chrome 扩展安全边界：[Chromium Extensions Security FAQ](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/docs/security_faq.md)
- Chrome 内容脚本和可注入网页：[Run scripts on every tab](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab)
- 浏览器工具栏 tooltip：[chrome.action](https://developer.chrome.com/docs/extensions/reference/api/action)
- DNR 规则及撤销：[declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- 权限与文件/无痕访问：[Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- 备注数据隐私：[Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)

**最终结论：** 1.0.1 已按浏览器权限允许的范围扩大悬浮标签覆盖，补充状态同步和恢复保护；10 组本地模拟测试通过，未发现新的已确认 Critical/High 漏洞。平台禁止注入的 Chrome 内部页面无法承诺真正“任何时候都浮在页面上”，中等级隐私/授权/表单兼容风险仍需开发者取舍和真实 Chrome 验收。
