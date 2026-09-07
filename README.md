# Felisa

X（Twitter）風のミニ SNS。**Client / Server 完全分離**構成。本番はさらに **クラウド Gateway / 自宅 Origin** に分離できる（[docs/DEPLOY.md](docs/DEPLOY.md)）。

- **Client** … 静的な HTML / CSS / ブラウザ JS（`Client/`）。サーバーロジックを持たず、`/api/*` を `fetch` するだけ。
- **Server** … Node.js + Express。`Client/`（本番は `dist/`）を静的配信 ＋ JSON API。データは `Server/data/` の JSON ファイル。画像は自前 PNG エンコーダ、動画は `ffmpeg`。依存は `express` / `express-rate-limit` のみ。
- **Gateway**（任意・本番向け） … `Gateway/server.js`。公開ドメインを受けるクラウド側のフロント。静的資産のみ自前配信し、それ以外（HTML シェル・`/api/*`）はすべて Cloudflare Tunnel 経由で自宅の Server（データの正本）へ転送する。データは持たないステートレスな中継役。

## セットアップ

```bash
npm install
npm start           # 開発（Server 単体）  → http://localhost:3000
npm run prod        # 本番（Server 単体）  → minify(dist/) + NODE_ENV=production
npm run build       # dist/ の生成のみ
npm run gateway      # 開発（Gateway 単体、要 ORIGIN_URL）
npm run prod:gateway # 本番（Gateway 単体）  → minify(dist/) + NODE_ENV=production
```

クラウド Gateway + 自宅 Origin 構成でのデプロイ手順は [docs/DEPLOY.md](docs/DEPLOY.md) を参照。

動画投稿を使うには `ffmpeg` を PATH に置く（無い場合、動画ボタンは自動的に無効化されます）。

## 機能

| カテゴリ | 内容 |
|---|---|
| アカウント | 登録（＝自動ログイン）/ ログイン / ログアウト、メール変更、パスワード変更（他端末を失効）、**ユーザー名変更（週1回・全データへ追従）**、**アカウント削除**（関連データをカスケード削除）、ログイン端末・IP・**User-Agent** の一覧と個別/一括ログアウト |
| 管理 | `Server/data/admin.json` に UserID を列挙すると、その人の名前の隣に **Admin ラベル**（投稿・プロフィール・通知・サイドバー） |
| 投稿 | 本文・**画像最大4枚**（クライアントで PNG 再変換・EXIF 除去）・**動画**（サーバーで MP4/480p 再エンコード・メタデータ削除）・**投票（2〜4択）**・**絵文字ピッカー** |
| タイムライン | おすすめ / フォロー中、**60秒ごとの「新しいポストをN件表示」**、いいね・リポスト・返信・ブックマーク・共有・自投稿削除 |
| ソーシャル | フォロー / フォロワー、**ブロック**（タイムライン・検索・プロフィールから除外）、通知（いいね・リポスト・返信・フォロー） |
| プロフィール | ヘッダ画像・アイコンの変更、外部リンク、利用開始日、投稿一覧 / いいね一覧 |
| その他 | **ブックマーク一覧**、キーワード / `#タグ` 検索、**「いま起きていること」（ハッシュタグ集計）** |
| UX | 確認は画面内モーダル / トースト（`alert` 不使用）、**画像はライトボックスでプレビュー**（遷移しない）、拡張子なしの URL（`/home` `/settings` …）、ページ遷移のちらつき対策 |
| セキュリティ | CSP、レート制限（全体500/分・認証系20/分）、CSRF 多層防御、セッショントークンはハッシュ保存＋失効可能、アップロードの型/サイズ/寸法検証、パス・トラバーサル対策、機密（メール等）の非開示、**Gateway 構成では共有シークレット（`GATEWAY_SECRET`）で自宅 Origin への直接アクセスを遮断** |

## ドキュメント

データモデル・API 全リファレンス・ルーティング・**Server/Client 分離の確認結果**・セキュリティは [docs/SPEC.md](docs/SPEC.md)。
クラウド Gateway + 自宅 Origin（Cloudflare Tunnel）構成の本番環境構築手順は [docs/DEPLOY.md](docs/DEPLOY.md)。
