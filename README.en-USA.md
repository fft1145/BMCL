[简体中文](README.md) | [繁體中文（香港／澳門）](README.zh-HK.md) | [繁體中文（台灣）](README.zh-TW.md) | [English (US)](README.en-US.md) | [**English (USA)**](README.en-USA.md) | [Official Website](https://bmcl26.netlify.app)

<div align="center">

<img src="build/icon.png" alt="BMCL Logo" width="96" height="96">

# BMCL

**Better Minecraft Launcher** · A Minecraft launcher that keeps the PCL2 workflow

[![Stars](https://img.shields.io/github/stars/fft1145/BMCL?style=for-the-badge&logo=github&label=stars&labelColor=444444&color=eac54f)](https://github.com/fft1145/BMCL/stargazers)
![GitHub Release](https://img.shields.io/github/v/release/fft1145/BMCL?label=release&logo=github&style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/fft1145/BMCL/build.yml?style=for-the-badge&label=build&logo=githubactions)

[![Issues](https://img.shields.io/github/issues/fft1145/BMCL?style=for-the-badge&label=issues&labelColor=444444&color=1F883D&logo=github)](https://github.com/fft1145/BMCL/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/fft1145/BMCL/total?style=for-the-badge&label=downloads&color=1F883D)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D6?style=for-the-badge&labelColor=444444&logo=windows)
<br />

[Download](https://github.com/fft1145/BMCL/releases/latest) |
[Official Website](https://bmcl26.netlify.app) |
[Source Code](https://github.com/fft1145/BMCL/archive/refs/tags/v2.3.0.zip)

[Report an Issue](https://github.com/fft1145/BMCL/issues/new/choose) |
[Release Notes](https://github.com/fft1145/BMCL/releases) |
[Notices](https://bmcl26.netlify.app/notices.json)

</div>

BMCL (Better Minecraft Launcher) is a fully local Minecraft launcher. It follows the PCL2 workflow, requires no sign-in, and depends on no self-hosted server — downloading, installing, and launching all happen on your own machine.

It ships with vanilla and modpack downloads, mod and loader installation, account and skin management, Java and memory configuration, plus self-update and crash self-check. The interface is rebuilt around the PCL2 layout, so existing PCL2 users can pick it up right away.

## 💻 Supported Platforms

| OS | Status | Requirements |
|---|---|---|
| Windows 11 | ✅ Fully supported | No extra runtime needed |
| Windows 10 1809 (17763) or newer | ✅ Fully supported | No extra runtime needed |
| Windows 7 / 8 / 8.1 | ❌ Not supported | Please upgrade (Electron 33 no longer supports them) |
| macOS / Linux | ⚠️ Development only | Sources build and run, no prebuilt release |

**✅ Fully supported**: everything we can reasonably support is supported; always use the latest version.

**❌ Not supported**: the launcher cannot run on these systems. Please upgrade your OS first.

**⚠️ Development only**: you can build and debug from source, but it is not a release target and comes without community support.

## ✨ Features

- **Instance management**: multiple instances side by side, each with its own versions, mods, saves, and settings.
- **Resource downloads**: vanilla, mods, modpacks, maps, resource packs, and shaders, with one-click Forge / Fabric / NeoForge / OptiFine installation.
- **Accounts**: Microsoft account sign-in and offline accounts, skin management, and a 4D real-time preview.
- **Java and memory**: automatic detection of installed Java, plus manual paths and JVM arguments.
- **Mirror acceleration**: switch download sources between the official servers and BMCLAPI.
- **Terracotta multiplayer**: built-in Terracotta / EasyTier — enter a lobby ID and play with friends, no port forwarding.
- **Auto-update**: checks GitHub Releases and only replaces the launcher's own files.
- **Crash self-check**: reads logs and suggests a diagnosis when the game or launcher crashes.
- **Announcements**: notices published from the website backend show up inside the launcher.

## 📦 Download & Installation

| Channel | Description |
|---|---|
| [GitHub Releases](https://github.com/fft1145/BMCL/releases/latest) | Latest portable `Better-MC-Launcher.exe`, unzip and run |
| [Official Website](https://bmcl26.netlify.app/#download) | More stable download page in mainland China, with checksums |
| [Source Code](https://github.com/fft1145/BMCL/archive/refs/tags/v2.3.0.zip) | Full source for the current version |

The launcher is portable and needs no installation. On first run it initializes its own data directory and never touches your existing `.minecraft`.

## 🖼️ Screenshots

<div align="center">
<img src="docs/screenshots/home.png" alt="Home" width="49%">
<img src="docs/screenshots/download.png" alt="Downloads" width="49%">
<img src="docs/screenshots/settings.png" alt="Settings" width="49%">
</div>

## 🚀 Run from Source

```bash
npm install
npm start        # launch the GUI (window title: BMCL)
npm test         # run core unit tests (no Electron required)
npm run dist     # build the Windows portable package
```

## 🔒 Security Notes

1. Updates only replace the launcher's own files (`main.js`, `preload.js`, `package.json`,
   `src/`, `renderer/`, `launcher-version.json`) and **never overwrite game files**.
   The updater validates every path first and rejects anything under `.minecraft`,
   `saves`, `mods`, `versions`, `libraries`, or `options.txt`.
2. Game data lives in the launcher's own data directory (`<userData>/game`) by default,
   so your existing `.minecraft` is left alone. You can change the game directory in Settings.
3. Update checks use GitHub Releases; the download source can be official servers or the BMCLAPI mirror.

## 📊 Statistics

[![Star History Chart](https://api.star-history.com/svg?repos=fft1145/BMCL&type=Date)](https://star-history.com/#fft1145/BMCL&Date)

**Page views** (total / today): [![Hits](https://hits.zkitefly.eu.org/?tag=https://github.com/fft1145/BMCL)](https://hits.zkitefly.eu.org/?tag=https://github.com/fft1145/BMCL&web=true)

## ❤️ Contributors

Thanks to everyone who has suggested features, reported bugs, and contributed code to BMCL.

[View contributors](https://github.com/fft1145/BMCL/graphs/contributors)

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE), the same license used by PCL CE.

You are free to use, modify, and distribute it, including commercially, as long as you keep the [LICENSE](LICENSE) file and copyright notice and state your changes when redistributing.

---

**Links**: [Official Website](https://bmcl26.netlify.app) · [Issues](https://github.com/fft1145/BMCL/issues) · [Releases](https://github.com/fft1145/BMCL/releases) · [Afdian](https://afdian.com/a/fft1145)
