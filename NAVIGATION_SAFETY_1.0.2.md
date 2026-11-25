# LinkEntryGuard 1.0.2 — 连续导航安全复核与保护增强

基线：用户已实机验收的 NavigationFix，构建 1.0.2-r20261125.7。
新构建：1.0.2-r20261125.8；Manifest 版本保持 1.0.2。

## 决策

不自动扩大未列入白名单的访问权限。DNR RuleCondition 支持 tabIds、URL、initiatorDomains 等匹配条件，但不能绑定某一条 HTTP 重定向链的 requestId。仅用同源与时间窗口，不能排除同一标签页中的独立新导航。webRequest 观察方案需要新增权限，且与 webNavigation 没有规定的事件顺序。本轮不增加该权限，不安装宽泛同源 allow 规则，不宣称已经消除重复确认。

官方参考：
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest/
- https://developer.chrome.com/docs/extensions/reference/api/webNavigation/
- https://developer.chrome.com/docs/extensions/reference/api/webRequest/

## 修改

- background.js：增加当前标签页近期打开请求的同源/跨源观察标记（25 秒；不用于授权）；新增白名单自动操作循环保护。自第一次自动打开起 30 秒内，同一精确网络网址第三次自动打开或累计第 13 次自动打开时，暂停自动打开；可手动确认，手动打开重置计数。不同标签页独立。该保护为内存中的尽力机制，后台重启会清空计数。状态过期、标签关闭时清理；总表有容量限制。未新增持久化网址记录。
- confirm.html / confirm.css / list-quick.js：说明近期同源或跨源访问情况，不把它宣称为已经证实的重定向。自动操作暂停后保留正常手动确认界面。
- popup.js：新增脱敏日志原因文字。继续仅持久化原有域名、时间、事件类型、原因和阶段，不记录完整网址、查询参数或令牌。
- ui-transport.js 及相应测试：统一内部构建号。
- tests/confirm-integration.js / tests/list-quick-events.js：增加精确授权不扩张、同源和跨源提示、端口隔离、不同标签页独立、正常六步白名单访问、重复自动打开暂停、黑名单优先、手动恢复和日志隐私测试。

## 验收

全部 16 组 Node 自动化测试及 JavaScript 语法检查通过。此为模拟 Chrome API 的回归测试，并非真实 Chrome DNR 网络联调；当前轮未进行真实浏览器验证。原有权限、Manifest、静态规则和发布工作流未修改。

## 使用建议

对于明确希望在当前 Profile 使用的 Google Drive，可主动选择 `https://drive.google.com` 的整个网站（同源）白名单；该选择是长期授权，并非本次临时授权，黑名单仍优先。其他域名仍独立核验。没有选择网站白名单的链接，后续未获授权的网址仍须确认。新版本的循环保护可能让复杂白名单流程偶尔需要手动确认，这是明确的安全/体验取舍。
