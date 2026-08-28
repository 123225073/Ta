<div align="center">

<img src="./Resources/Brand/Ta-AppIcon.png" width="112" alt="Ta">

# Ta for Windows

### 囲んで、拓す。

[![Windows](https://img.shields.io/badge/Windows-10%2F11-1676D2.svg)](./windows/README.md)
[![Version](https://img.shields.io/badge/Windows-v1.1.11-E62D1B.svg)](./docs/release-notes-v1.1.11.md)
[![License](https://img.shields.io/badge/License-MIT-D6402F.svg)](./LICENSE)

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md)

</div>

## このフォークについて

このリポジトリは [kangarooking/Ta](https://github.com/kangarooking/Ta) を基にした Windows 向けフォークです。元の macOS/Swift 実装は `Sources/`、`Tests/`、`Package.swift` に残しています。現在の主な成果物は、`windows/` に実装した Windows 10/11 x64 クライアントです。

## Windows v1.1.11 の主な機能

- DPI とマルチディスプレイに対応したフル解像度・可逆 PNG キャプチャ。
- ウインドウ境界の自動認識、手動選択、移動、8 方向リサイズ、ダブルクリックまたは `Enter` で確定。
- 選択範囲は元の色と鮮明さを維持し、範囲外だけをグレー表示。
- 完了したキャプチャを自動的にクリップボードとローカル履歴へ保存。
- クイックキャプチャは編集画面を開かず、コピーと保存だけを実行。
- 中国語/英語のオフライン OCR と、OpenAI-compatible、Claude、Gemini などの設定可能な視覚モデル。
- 同じ画像の OCR、画像理解、翻訳結果をキャッシュし、再実行は明示操作でのみ実施。
- 注釈画面は大きな画像を最初に全体表示し、手動ズームにも対応。
- 移動可能な画像ピン。ツール操作、透明度、回転、反転、クリック透過、終了に対応。
- Windows のグローバルショートカットをキー入力から記録し、競合を検査。
- 撮影時に Ta を完全に隠す、表示したままにする、毎回確認する、の三つの設定。他のアプリは隠しません。

自動非表示では、Ta を透明化して非表示にした後、Windows DWM の合成完了を待ってから画面を取得します。これにより、元の位置に薄い残像が写り込む問題を防ぎます。

## 既定のショートカット

| 操作 | ショートカット |
|---|---|
| クイック OCR | `Ctrl + Shift + 1` |
| 通常キャプチャ | `Ctrl + Shift + 2` |
| クイックキャプチャ | `Ctrl + Shift + 3` |
| キャプチャしてピン留め | `Ctrl + Shift + 4` |
| スクロールキャプチャ | `Ctrl + Shift + 5` |
| キャプチャして翻訳 | `Ctrl + Shift + 6` |

すべて設定画面で直接再記録できます。

## ビルド

必要環境：Windows 10 22H2 または Windows 11 x64、Node.js 22+、npm。

```powershell
cd windows
npm ci
npm run dist
```

生成されるインストーラーは `windows/release/Ta-Windows-1.1.11-x64-Setup.exe` です。インストーラー、ビルド成果物、OCR モデルのコピー、ローカル設定は Git に含めません。

```powershell
npm test
npm run typecheck
npm run test:preview-fidelity
npm run smoke:e2e
```

## プライバシーと制限

通常キャプチャ、注釈、ピン留め、長い画像、ローカル OCR は端末内で処理します。ユーザーがクラウド画像認識または翻訳を明示的に実行した場合だけ、設定済みサービスへ画像を送信します。API Key は Windows の Electron `safeStorage` で暗号化され、平文をリポジトリやログへ保存しません。

DRM や OS が保護する動画領域は Windows により黒く表示される場合があります。複数ディスプレイをまたぐ一つのドラッグ選択は未対応です。アニメーションの多いページの長画像は接合結果の確認が必要です。

[Windows ガイド](./windows/README.md)、[v1.1.11 更新内容](./docs/release-notes-v1.1.11.md)、[受け入れレポート](./docs/windows-acceptance.md)も参照してください。

## 上流とライセンス

元プロジェクトを `upstream` として保持し、必要な変更だけを確認して取り込む方法を推奨します。独立した `windows/` は Swift と競合しにくい一方、README、ブランド、共通文書は手作業で解決してください。履歴を強制上書きする自動同期は推奨しません。

[MIT License](./LICENSE) で公開しています。元の Ta 作者とすべての貢献者に感謝します。
