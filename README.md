# BMCL

基于 PCL2 交互思路的 Minecraft 启动器，完全本地运行，不依赖任何自建服务器。

- 官网：https://fgame12.netlify.app
- 项目地址：https://github.com/fft1145/BMCL
- 国内下载：https://fgame12.netlify.app（本站下载区）

## 运行

```bash
npm install
npm start        # 启动 GUI（窗口标题 fft1145）
npm test         # 运行核心模块单元测试（无需 Electron）
npm run dist     # 打包 Windows 便携版
```

## 安全约定

1. 更新只覆盖启动器自身文件（`main.js`、`preload.js`、`package.json`、
   `src/`、`renderer/`、`launcher-version.json`），**绝不覆盖游戏文件**。
   更新器在执行前会逐个校验路径，任何 `.minecraft`、`saves`、`mods`、
   `versions`、`libraries`、`options.txt` 等游戏内容都会被拒绝。
2. 游戏数据默认放在启动器自己的数据目录（`<userData>/game`），
   不会碰你已有的 `.minecraft`。可在「设置」里修改游戏目录。
3. 更新检查使用 GitHub Releases，下载源可选官方或 BMCLAPI 镜像。

## 设置页包含

- 更新检测（含自动检测开关）
- 崩溃自检：上一次启动器异常退出 / 游戏崩溃报告自动诊断
- 下载源切换、内存、Java 路径、游戏目录、玩家名
- 「下载是否被禁止」检测：网络不可达时自动提醒，并跳过自动更新
