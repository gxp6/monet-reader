# 把「莫奈阅读器」上传到你的 GitHub

写给从来没上传过代码的人。三条路线，选一条就行：

| 路线 | 适合谁 | 需要装东西吗 | 以后改代码方便吗 |
| --- | --- | --- | --- |
| [**路线 A：网页上传**](#路线-a网页上传不用装任何东西) | 只想先把代码传上去看看 | 不用 | 一般（要一个个传） |
| [**路线 B：Git 命令行**](#路线-bgit-命令行推荐长期使用) | 想正经用 Git 的人 | 装一个 Git | 最方便 |
| [**路线 C：GitHub Desktop**](#路线-cgithub-desktop纯图形界面) | 不想敲命令 | 装一个客户端 | 方便 |

> **先做一件事**：注册 GitHub 账号，如果已经有了就跳过。
> 打开 <https://github.com/signup>，填邮箱、密码、用户名，去邮箱点验证链接即可。用户名会出现在你的主页地址里（`github.com/你的用户名`），想好了再定。

---

## 上传之前：三个概念，30 秒看懂

1. **仓库（Repository）** —— 就是一个项目文件夹，GitHub 帮你存在云端。
2. **提交（Commit）** —— 给"这一版代码"拍个快照，以后可以回退。
3. **推送（Push）** —— 把本地的提交传到 GitHub 上。

还有一个必须知道的：**`.gitignore`**。
这个项目里已经写好了一份 `.gitignore`，里面写着 `library/`。
`library/` 是你的书库——里面是你要看的小说正文，**属于私人内容，不该传到公开仓库**。
按下面的步骤走，它就不会被传上去。但如果你用【路线 A】手动拖文件，**请千万别拖 `library/` 这个文件夹**。

---

## 路线 A：网页上传（不用装任何东西）

### 1. 新建一个仓库

1. 登录 GitHub，点右上角的 **`+`** → **New repository**
2. **Repository name** 填 `monet-reader`（或者你喜欢的名字，只能用英文、数字、`-`、`_`）
3. 下面有个 **Description**，可以填一句话，比如：`莫奈配色的本地小说阅读器，支持 TXT / EPUB`
4. 选择公开还是私有：
   - **Public**：所有人可见。开源项目选这个。
   - **Private**：只有你自己能看。暂时不想给别人看就选这个，以后可以随时改成公开。
5. **Initialize this repository with** 那一栏的复选框**全部不要勾**（不要 Add README、不要 .gitignore——我们本地已经有了，勾了反而会冲突）
6. 点 **Create repository**

创建完会跳到一个空仓库页面，上面有 `https://github.com/你的用户名/monet-reader.git` 这样的地址，**先复制下来备用**。

### 2. 上传文件

在空仓库页面点 **uploading an existing file**（或者仓库页面里的 **Add file** → **Upload files**）。

然后打开你电脑上的 `monet-reader` 文件夹，**把这些东西框选后拖进网页的上传区**：

```
✅ start.bat
✅ server.py
✅ README.md
✅ LICENSE
✅ .gitignore        ← 注意：这是隐藏文件，需要先在文件资源管理器里开启"显示隐藏项目"
✅ app\              （整个文件夹）
✅ samples\          （整个文件夹）
✅ docs\             （整个文件夹）

❌ library\          ← 千万别拖！这是你的书库
❌ .runtime\         ← 也别拖，这是运行时产生的临时文件
❌ __pycache__\      ← 也别拖
```

现代浏览器支持直接拖文件夹，子目录结构会保留。

拖完后在页面下方填一句说明，例如 `第一次提交：莫奈阅读器`，然后点绿色的 **Commit changes**。

> **网页上传的限制**：一次最多 100 个文件，单个文件不超过 25MB。这个项目完全够用。

### 3. 检查一下

回到仓库首页，应该能看到 README 的内容自动显示在下面，还带着截图。如果看到了，恭喜，上传成功 🎉

**这种方式以后怎么改代码？**
在仓库页面点进某个文件 → 右上角铅笔图标 → 改完 → 拉到底 Commit changes。适合小修小补，改多了还是走路线 B。

---

## 路线 B：Git 命令行（推荐长期使用）

### 1. 装 Git

你的电脑上还没有 Git。打开 **PowerShell**（开始菜单搜 `PowerShell`），粘贴这一行回车：

```powershell
winget install -e --id Git.Git
```

装完**关掉 PowerShell 重新打开一个**（让 PATH 生效），然后验证：

```powershell
git --version
```

有版本号输出（比如 `git version 2.47.0`）就成功了。

> 如果 `winget` 用不了，去 <https://git-scm.com/download/win> 下载安装包，一路 Next 即可，默认选项就行。

### 2. 告诉 Git 你是谁

这两行填你自己的信息（会记录在每个提交里）：

```powershell
git config --global user.name "你的名字或昵称"
git config --global user.email "你的GitHub注册邮箱"
```

### 3. 在 GitHub 网页上建一个空仓库

和[路线 A 的第 1 步](#1-新建一个仓库)完全一样：新建仓库、**不要勾任何初始化选项**、创建后复制仓库地址。

### 4. 在项目文件夹里初始化并提交

打开 PowerShell，进入项目文件夹（把路径换成你的实际位置）：

```powershell
cd "D:\AI\zcodedata\.zcode\workspace\default\monet-reader"
```

然后**逐行**执行：

```powershell
# 1. 把这个文件夹变成 Git 仓库
git init

# 2. 把所有文件加入待提交列表（.gitignore 里排除的不会被加进来）
git add -A

# 3. 确认一下要提交哪些文件（这步很值得看！）
git status
```

第 3 步会列出准备提交的文件。**仔细检查列表里没有 `library/`**——如果有，说明 `.gitignore` 没生效，先别继续。

```powershell
# 4. 生成第一个提交
git commit -m "第一个版本：莫奈配色的本地小说阅读器"

# 5. 把默认分支改名为 main（GitHub 的默认分支名）
git branch -M main

# 6. 关联到你刚建的 GitHub 仓库（把地址换成你自己的）
git remote add origin https://github.com/你的用户名/monet-reader.git

# 7. 推送到 GitHub
git push -u origin main
```

### 5. 第一次推送会要求登录

第 7 步会弹出一个窗口让你登录 GitHub——**选 "Sign in with your browser"，在浏览器里点授权就完事了**。

> **如果没弹窗、而是在命令行里问用户名密码**：
> 2021 年之后 GitHub 不再接受账号密码，要改用 **Personal Access Token（令牌）**：
> 1. 打开 <https://github.com/settings/tokens> → **Generate new token** → **Generate new token (classic)**
> 2. Note 随便填（比如 `我的电脑`），Expiration 选 90 天或 No expiration
> 3. 勾选 **`repo`** 这一项（这一项就够了）
> 4. 拉到底点 **Generate token**，**立刻把这串 `ghp_xxxxx...` 复制下来**（离开页面就看不到了）
> 5. 回到命令行：用户名填你的 GitHub 用户名，**密码位置粘贴这串 token**
>
> 这串 token 就等于密码，**别发给任何人，也别写进代码里**。

推送完成后刷新仓库页面，文件就在了。

### 6. 以后怎么更新代码

改完代码，站在项目文件夹里执行三条命令：

```powershell
git add -A
git commit -m "说一句这次改了什么"
git push
```

想看自己改了什么用 `git diff`，看历史用 `git log --oneline`。

---

## 路线 C：GitHub Desktop（纯图形界面）

不想碰命令行的话，这是最省心的图形方案。

1. 到 <https://desktop.github.com> 下载安装，打开后用你的 GitHub 账号登录
2. 菜单 **File** → **Add local repository**，选中你的 `monet-reader` 文件夹
   - 如果提示 "This directory does not appear to be a Git repository"，点它给的 **create a repository** 链接，然后点 **Create repository**
3. 左侧会列出所有改动文件，**先扫一眼确认里面没有 `library/`**
4. 左下角 **Summary** 填一句说明（比如 `第一次提交`），点 **Commit to main**
5. 点顶部的 **Publish repository**（如果本地还没关联远程仓库）或 **Push origin**
   - Publish 时可以取消勾选 "Keep this code private" 让它公开

以后改完代码，打开 GitHub Desktop → 填 Summary → Commit → Push（右上角）就行。

---

## 常见问题

**推送时报 `failed to push some refs` / `rejected`？**
多半是远程仓库里已经有了内容（比如你建仓库时勾了 Add README）。两种解法：
```powershell
# 解法一：把远程的东西拉下来合并（会弹窗让你输入合并说明，直接关掉即可）
git pull --rebase origin main
git push -u origin main
```
或者干脆删掉那个仓库重建一个空仓库（更快）。

**怎么确认 `library/` 真的没被传上去？**
在 GitHub 仓库页面看文件列表，**不应该有 `library` 这个文件夹**。如果不小心传上去了：点进 `library` 文件夹 → 右上角 `...` → Delete directory → Commit。注意：**删掉只是从最新版本里移除，历史提交里还能查到**。如果书很私密，最稳妥的办法是删掉整个仓库重新建一个。

**我上传后想改仓库名字 / 改成私有？**
仓库页面 → **Settings** → 最上面可以改名字；拉到最下面 **Danger Zone** → **Change visibility** 可以改公开/私有。

**为什么 README 会自动显示在仓库首页？**
GitHub 会自动把根目录下的 `README.md` 渲染在仓库首页下方。所以写好的 README 就是项目的门面——截图、用法、许可证都放在里面。

**想让别人不用装 Python 就能用？**
可以把这个仓库发布成 Release（仓库页面右侧 **Releases** → **Create a new release**），把打包好的 exe 作为附件传上去。打包命令：

```powershell
pip install pyinstaller
pyinstaller --noconfirm --noconsole --name "莫奈阅读器" --add-data "app;app" server.py
```

生成在 `dist\莫奈阅读器\`。**注意：`dist` 和 `build` 目录也应该加进 `.gitignore`**，别把几百兆的打包产物提交进仓库。

---

## 最后：给仓库加点门面（可选）

- **Topics**：仓库页面右上角齿轮图标 → 添加 `reader`、`novel`、`monet`、`python`、`windows` 之类的标签，方便别人搜到
- **仓库简介**：同样的齿轮图标里可以填一句话简介和网站地址
- **截图**：README 里已经引用了 `docs/images/` 下的图片，传上去就会显示

祝你的第一个仓库顺利 🎉
