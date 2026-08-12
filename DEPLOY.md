# RhythmScore 官网部署指南（Cloudflare Pages + GitHub Releases）

> 架构：官网页面 → **Cloudflare Pages**（免费、全球 CDN、国内可访问）；DMG 安装包 → **GitHub Releases**（免费、单个文件 ≤2GB）；域名 → `rhythmscore.cn` CNAME 指向 Pages。

---

## 一、部署官网到 Cloudflare Pages（10 分钟）

1. 注册/登录 [Cloudflare](https://dash.cloudflare.com)，进入 **Workers & Pages → Create → Pages → Upload assets**（如果之前已连 GitHub 也可以用 Git 集成，二选一）。
2. 上传**本目录 `landing/`** 里的所有文件（`index.html`、`404.html`、`_headers`）。
3. 项目名随意（如 `rhythmscore`），上传完会得到地址 `https://<项目名>.pages.dev` —— 先用这个地址检查官网是否正常。
4. 绑定域名：Pages 项目 → **Custom domains → Set up a custom domain** → 输入 `rhythmscore.cn` → 按提示添加 DNS 记录（Cloudflare 会引导，通常是一条 CNAME：`rhythmscore.cn` → `<项目名>.pages.dev`，**代理模式开橙色云朵**）。
5. 等 SSL 生效（自动签发，1-2 分钟），访问 `https://rhythmscore.cn` 验证。

> 如果 `rhythmscore.cn` 的 DNS 不在 Cloudflare：先去 **域名注册商后台** 把 NS 改成 Cloudflare 提供的两个地址（Add a site 时会给），等生效后 Cloudflare 才能管理 DNS。或者只在注册商 DNS 加一条 CNAME 记录指向 `<项目名>.pages.dev`（Cloudflare Pages 也能签发 SSL）。

## 二、上传 DMG 到 GitHub Releases（下载链接）

1. 在 GitHub 建仓库（如 `rhythmscore`），把本目录文件推上去（可选，用于存档）。
2. 打开仓库 → **Releases → Create a new release**：
   - Tag：`v0.2.0`；标题：`RhythmScore v0.2.0`；写几句更新说明。
   - 附件：上传 `RhythmScore-0.2.0.dmg`（打包产物）。
3. 发布后得到下载链接：
   ```
   https://github.com/<你的用户名>/rhythmscore/releases/latest/download/RhythmScore-0.2.0.dmg
   ```
4. 把这个链接填进官网 `index.html` 的下载按钮（把 `你的GitHub用户名` 替换成真实用户名）。
   - `releases/latest` 是"最新版"地址，以后发新版本**不用再改官网链接**，只需新开一个 Release 并上传同名的 DMG。

## 三、日常更新流程

- **改官网内容**：修改 `landing/index.html` → 重新上传到 Cloudflare Pages（或推 GitHub 自动部署）→ 立即生效（HTML 缓存 5 分钟）。
- **发软件新版本**：
  1. 打包新 DMG（文件名保持 `RhythmScore-<版本>.dmg`）。
  2. GitHub 新建 Release（tag 递增，如 `v0.3.0`），上传新 DMG。
  3. 官网按钮 `latest` 链接自动指向新版本；如需在页面文案更新版本号，改 `index.html` 里"当前版本 vX.X.X"。

## 四、常见问题

- **官网打不开**：先确认 `https://<项目名>.pages.dev` 能开（能开=Pages 正常，是域名/DNS 问题）；检查 DNS 记录和 NS 是否已生效（`nslookup rhythmscore.cn`）。
- **下载慢**：GitHub 在国内下载速度不稳定属正常，可提示用户"多试几次或稍后再下"。正式收费后若反馈多，可加国内镜像（需备案）。
- **要备案吗**：不需要。Cloudflare + GitHub 均在境外，`.cn` 域名解析到境外服务器可免备案。
