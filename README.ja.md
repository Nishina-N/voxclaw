# Voxclaw 🐾

[🇺🇸 English](README.md) | 🇯🇵 日本語

**音声ファーストのAIアシスタントPWA。**
自然に話すだけで Gemini がリアルタイムに意図を推定し、テキストボックスに表示します。確認・編集してから実行。すべてブラウザで完結。

> ⚠️ **特許出願中（2026年）：**「音声入力による意図推定と個人適応型情報処理方法およびシステム」

---

## 使い方の流れ

```
[マイク] ──► 音声ストリーム ──► Gemini Live API ──► 意図テキスト（編集可能）
                                                           │
                                                  [確認・編集]
                                                           │
                                                       [送信] ──► スキル実行 ──► 返答
```

1. **話す** — マイクボタンをタップして自然に話す
2. **確認** — Gemini がリアルタイムで意図を推定し、テキストボックスに表示
3. **編集** — 推定されたテキストを必要に応じて修正
4. **実行** — 送信すると voxclaw が適切なスキルを実行し、結果を返答

「編集可能な意図」のステップが Voxclaw のコアです。AIが何をするかを常にユーザーがコントロールできます。

---

## 主な特徴

| 特徴 | 説明 |
|---|---|
| **リアルタイム意図推定** | 音声を Gemini Live API にストリーミング。推定された意図が実行前に編集可能なテキストとして表示される |
| **動的スキル** | `skills/` にJSファイルを置くだけで即時追加、リビルド不要 |
| **クロンスケジュール** | アプリ内の Cron タブからスキルの定時実行を設定 |
| **Key Binder** | APIキーを別コンテナで隔離。スキルエンジンが直接クレデンシャルを保持しない設計 |
| **PWA** | モバイル・デスクトップにインストール可能。UIシェルはオフライン動作 |
| **JWT認証** | パスワード保護のシングルユーザーアクセス、セッション有効期限7日 |

---

## タブ構成

| タブ | 説明 |
|---|---|
| **Chat** | メイン画面 — 音声またはテキスト入力、スキルの実行結果を表示 |
| **Skills** | 利用可能なスキルの一覧と説明 |
| **Cron** | スキルの定時実行スケジュールを設定（時刻・曜日・送信先） |
| **Task** | *（実装中）* |
| **Settings** | APIキー（Brave Search、Mapbox）と Google 認証の管理 |

---

## クイックスタート

```bash
# 1. クローン
git clone https://github.com/Nishina-N/voxclaw
cd voxclaw

# 2. 環境変数を設定
cp .env.example .env
# GEMINI_API_KEY、PWA_PASSWORD、JWT_SECRET を記入

# 3. スキル用 API キーを設定（任意）
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
# Brave Search、Mapbox、Google など必要なキーを記入

# 4. 起動
docker-compose up -d --build

# 5. アクセス
# ブラウザで http://localhost:8080 を開き、PWA_PASSWORD でログイン
```

---

## アーキテクチャ

詳細は **[docs/architecture.md](docs/architecture.md)** を参照してください。

構成図（draw.io）: [`docs/architecture.drawio`](docs/architecture.drawio)

```
ブラウザ (PWA)  ──────────────────────────────────────────────────────────
  voice-pwa-frontend   nginx :3000       静的 PWA、/ws /api/* をプロキシ
  voice-pwa-backend    Node.js :8080     Gemini Live ↔ 意図 WebSocket
                                         確定した意図 → voxclaw コア

voxclaw コア ────────────────────────────────────────────────────────────
  voxclaw              Gemini Agent      スキル実行・エージェントループ
  keybinder            キー隔離          外部 API プロキシ (:3001)
  CronRunner           node-cron         スケジュール実行

共有ボリューム ──────────────────────────────────────────────────────────
  SQLite DB            messages / tasks
  functions/           動的スキル（ホットリロード対応）
  skills/              スキルの組み合わせ手順書
  config/              cron.json、channels.json
```

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/setup.md](docs/setup.md) | インストールガイド（PWA 優先、Discord・Google はオプション） |
| [docs/architecture.md](docs/architecture.md) | システム構成・データフロー |
| [docs/skills.md](docs/skills.md) | スキルの作り方・組み込みツール一覧・Key Binder API リファレンス |

---

## ライセンス

ソースコードは個人・研究利用向けに [MIT](LICENSE) で公開しています。

> 「音声入力 → 意図推定 → ユーザー編集 → 実行」のパイプラインを用いた商用製品の開発については、特許出願中のため事前にご相談ください。
