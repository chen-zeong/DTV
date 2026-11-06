# DTV MSI 安装包

Wails v3 官方只提供 NSIS（`.exe`）和 MSIX（`.msix`），没有 MSI。这里用
WiX Toolset v3 的 `candle.exe` / `light.exe` 额外生成一个真正的 Windows
Installer 包。

## 特点

- **per-user 安装**：默认装到 `%LOCALAPPDATA%\Programs\DTV`，不需要管理员权限，
  卸载入口在「设置 → 应用」。
- 创建开始菜单和桌面快捷方式，卸载时一并清理。
- 不做 Authenticode 签名：MSI 和里面的 `dtv.exe` 都是 `NotSigned`。
- 依赖系统已有的 WebView2 Runtime（Windows 10/11 一般自带）。

## 依赖

1. WiX Toolset v3.14 的 binaries zip：
   <https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip>
2. 解压到任意目录，例如 `C:\tools\wix314`，确保里面有 `candle.exe` / `light.exe` /
   `WixUIExtension.dll`。

## 构建

```powershell
# 1. 先生成未签名的 dtv.exe
wails3 build SIGN_ENABLED=false

# 2. 打包 MSI
powershell -NoProfile -ExecutionPolicy Bypass -File build\windows\msi\build-msi.ps1 `
  -WixBin C:\tools\wix314
```

或通过 Taskfile：

```powershell
wails3 task windows:msi WIX_BIN="C:\tools\wix314"
```

输出：`bin\dtv-amd64.msi`。

> 说明：`light` 默认会跑 ICE 校验，它依赖本机 Windows Installer 服务/脚本引擎，
> 在 CI/受限环境里经常失败；脚本加了 `-sval` 跳过 ICE。生成的 MSI 已在本机
> 做过静默安装/卸载验证（安装 → 文件与快捷方式存在 → 卸载 → 清理干净）。
