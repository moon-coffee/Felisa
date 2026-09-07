# Alpha — 仕様書

X（Twitter）風のミニ SNS。**Client（フロントエンド）** と **Server（バックエンド）** を完全に分離した構成。

- **Client** … 静的な HTML / CSS / ブラウザ JS のみ。Node API・サーバーロジックを一切含まない。API は `fetch` で `/api/*` を叩くだけ。画像は `<canvas>` で PNG 化してからアップロードする。
- **Server** … Node.js + Express。`Client/`（本番は `dist/`）をそのまま静的配信し、JSON API を提供。データは `Server/data/` 配下の JSON ファイル。画像は自前の PNG エンコーダ（`zlib`）、動画は `ffmpeg` を子プロセスで使用。

依存パッケージは `express` と `express-rate-limit` のみ（本番ビルド用の devDependencies を除く）。

---

## 1. ディレクトリ構成

```
Web/
├── package.json / build.js
├── docs/SPEC.md
├── Client/                         配信されるフロントエンド
│   ├── login.html / signin.html          （style.css）
│   ├── home.html          /home           タイムライン（要ログイン）
│   ├── profile.html       /<username>     プロフィール
│   ├── status.html        /status/<id>    投稿詳細・スレッド
│   ├── search.html        /search?q=      検索
│   ├── notifications.html /notifications  通知（要ログイン）
│   ├── bookmarks.html     /bookmarks      ブックマーク（要ログイン）
│   ├── settings.html      /settings       設定（要ログイン）
│   ├── home.css                           SNS 画面共通スタイル
│   └── js/
│       ├── common.js   API/描画/操作/投稿ボックス/サイドバー/ダイアログ（全ページ共通）
│       ├── login.js signin.js home.js profile.js status.js
│       ├── search.js notifications.js bookmarks.js settings.js
└── Server/
    ├── server.js       配信・ルーティング・セキュリティヘッダ・レート制限・生バイト受信
    ├── auth.js         認証 / 自分・アカウント設定 / セッション / 公開プロフィール / フォロー / ブロック / 画像配信
    ├── posts.js        タイムライン / 投稿・返信 / スレッド / 削除 / いいね・リポスト・ブックマーク / 投票
    ├── media.js        画像アップロード（PNG 検証）/ 動画アップロード（ffmpeg 再エンコード）/ メディア配信
    ├── notifications.js  通知一覧・既読
    ├── search.js / trends.js
    ├── present.js      ストアの生データ → クライアント向け整形
    ├── session.js / sessionStore.js   サーバー側セッション（端末一覧・失効に対応）
    ├── avatar.js       初期アイコン生成 / アイコン・ヘッダ画像の保存（256/任意の PNG）
    ├── mediaStore.js   PNG 検証・保存 / ffmpeg 検出・動画変換 / 配信パス解決
    ├── pngUtil.js      PNG シグネチャ + IHDR の検証
    ├── userStore.js postStore.js followStore.js blockStore.js
    ├── bookmarkStore.js notificationStore.js
    └── data/           実行時生成（.gitignore）
        ├── users.json posts.json follows.json blocks.json
        ├── bookmarks.json notifications.json sessions.json
        ├── session.secret（旧・未使用）
        ├── avatars/<sha1(userId)>.png   headers/<sha1(userId)>.png
        └── media/<uuid>.png | <uuid>.mp4
```

### Server / Client 分離の確認結果

- **Client** … `require` / `process` / `fs` などの Node API を一切使用しない。参照するのは DOM・`fetch`・`canvas`・`createImageBitmap` のみ。データの保存形式を知らず、常に `/api/*` の JSON（＋画像/動画の生バイト）だけを介してサーバーと通信する。
- **Server** … HTML テンプレートエンジンやサーバーサイドレンダリングを持たない。HTML は `Client/`（本番 `dist/`）のファイルを `res.sendFile` でそのまま返すだけ（文字列補間なし）。応答はそれ以外すべて JSON かバイナリ。DOM を知らない。
- **境界** … `/api/*`（JSON / 画像 PNG / 動画バイト）と静的アセット配信のみ。画像の縮小・PNG 再エンコード・EXIF 除去は **クライアントの canvas** が担当し、サーバーは受領時に PNG シグネチャ・寸法・サイズを**再検証**する（責務の分担 + 多層防御）。
- **ビルド** … `build.js` が `Client/` を minify して `dist/` を生成。本番は `dist/` を配信。

---

## 2. データモデル（`Server/data/*.json`、すべて配列）

読み込み時に旧レコードへ欠損フィールドを補完する。

### users.json
`userId`（一意 / `^[A-Za-z0-9_]+$` / 3文字以上）, `mail`（一意）, `password`（`scrypt` の `salt:hash`）, `createdAt`（ISO）, `displayName`（≤50）, `bio`（≤160）, `link`（`^https?://…` のみ保存 / ≤100）, `hasHeader`（bool）

### posts.json
`id`(UUID), `userId`, `text`(≤280), `createdAt`(ms), `replyTo`(id|null),
`likes`([userId]), `reposts`([{userId,createdAt}]),
`media`([{type:"image"|"video", id, width, height}] / 画像最大4・動画1),
`poll`(null | `{ options:[{text}], endsAt, votes:{ <userId>: optionIndex } }`)

### follows.json / blocks.json / bookmarks.json
`{follower,following,createdAt}` / `{blocker,blocked,createdAt}` / `{userId,postId,createdAt}`

### notifications.json
`{ id, userId(受信者), type:"like"|"repost"|"reply"|"follow", actor, postId|null, createdAt, read }`（自分の操作は記録しない）

### sessions.json
`{ id, userId, tokenHash(sha256), ip, ua, createdAt, lastSeenAt }`

### admin.json
`["userId", ...]` の配列（手動編集 / 先頭 BOM は許容）。ここに載る UserID のアカウントは、投稿・プロフィール・通知・サイドバーで名前の隣に **「Admin」ラベル**が付く（API の `author.isAdmin` / `user.isAdmin`）。ユーザー名変更に自動追従する。`.gitignore` で `Server/data/` を無視しつつ `admin.json` だけ追跡する。

### users.json 追加フィールド
`userIdChangedAt`（ms / null）… ユーザー名を最後に変更した時刻。次回変更可能時刻の算出に使う。

---

## 3. 認証・セッション

- パスワード: `crypto.scryptSync` ＋ ユーザーごとのランダムソルト、照合は `timingSafeEqual`。
- ログイン／登録成功で **256bit ランダムトークン** を Cookie `sid` に発行。サーバーには **sha256(token)** のみ保存（ファイル流出でセッションを奪われない）。
  - Cookie 属性: `httpOnly` / `SameSite=Lax` / 本番のみ `Secure` / `Max-Age` 30日。
- **登録＝自動ログイン**（サーバーが Cookie を発行）。
- セッションは**サーバー側で失効可能**: 端末一覧の表示、個別ログアウト、他端末一括ログアウト。パスワード変更で他端末を強制失効、アカウント削除で全失効。
- 要ログインページ（`/home` `/settings` `/bookmarks` `/notifications`）は `Cache-Control: no-store` ＋ サーバー側ガードで、ログアウト後の「戻る」でも表示させない。

---

## 4. 画像・動画

### アイコン / ヘッダ / 投稿画像（PNG）
- 生成アイコン: `userId` の SHA-256 から決定的に identicon を描画。手書き PNG エンコーダ（`zlib` のみ）で **256×256 の PNG**、`eXIf`/`tEXt`/`tIME` を書かないので**メタデータなし**。
- ユーザーがアップロードする画像（投稿添付 / アイコン / ヘッダ）は **クライアントの `<canvas>.toBlob('image/png')`** で再描画してから送信 → 全メタデータ（EXIF 等）が除去され、常に PNG になる。
- サーバーは受領時に PNG シグネチャ・IHDR 寸法（≤4096、アイコンは正方形 64〜1024）・バイトサイズ（≤8MB、生バイト上限9MB）を再検証。ファイル名は `uuid` / `sha1(userId)`（ユーザー入力をパスに使わない）。

### 動画（MP4 / 480p）
- `POST /api/media/video` は生バイトを受信（≤80MB、`express.raw` 上限85MB）。
- サーバーで `ffmpeg` を **引数配列で `spawn`（シェル未経由）** し再エンコード:
  `-vf scale=-2:'min(480,ih)'`（高さ480pまで） / `libx264 crf 28` / `aac 128k` /
  **`-map_metadata -1`（全メタデータ削除）** / `+faststart` / `-t 140`（長さ上限）。
  一時入力ファイルはランダム名で `os.tmpdir()`、180秒でタイムアウト（SIGKILL）、失敗時は生成物を削除。
- 起動時に `ffmpeg -version` の成否を判定。無ければ `GET /api/capabilities` が `video:false` を返し、`POST /api/media/video` は `501`、クライアントは動画ボタンを無効化。

---

## 5. HTTP ルーティング（`server.js`）

| パス | 内容 |
|---|---|
| `GET /` | ログイン済 → `/home` / 未 → `/login` |
| `GET /login` `/signin` | ログイン・登録画面 |
| `GET /home` `/settings` `/bookmarks` `/notifications` | **要ログイン**。未ログインは `/login` へ |
| `GET /search` `/status/:id` | シェルを返す（閲覧は未ログインでも可） |
| `GET /:username` | プロフィール（予約語・拡張子付きは除外） |
| `GET /*.html`（旧 URL） | 対応する拡張子なし URL へ `301` |
| その他の静的ファイル | `express.static`（`Client/` または `dist/`） |

---

## 6. JSON API（`/api` 配下・レート制限対象）

共通形式 `{ ok, ... }` / 失敗 `{ ok:false, errors:{ <field>|form } }` / 未ログインは `401`。

### 認証・アカウント
| M・パス | ボディ | 備考 |
|---|---|---|
| `POST /api/register` | `{userId,mail,password}` | `201`、Cookie 発行（自動ログイン） |
| `POST /api/login` | `{identifier,password}` | |
| `POST /api/logout` | — | 現在のセッションを失効 |
| `GET /api/me` | — | `{ok,user,unreadNotifications}` |
| `PUT /api/me` | `{displayName?,bio?,link?}` | |
| `PUT /api/me/email` | `{email,password}` | パスワード再確認・重複チェック |
| `PUT /api/me/password` | `{currentPassword,newPassword}` | 他端末を失効 |
| `PUT /api/me/username` | `{userId,password}` | **ユーザー名（@ハンドル）の変更。1週間に1回まで**。成功時に投稿・いいね・リポスト・投票・フォロー・ブロック・ブックマーク・通知・セッション・アイコン/ヘッダ・`admin.json` の該当 ID を新 ID へ一括更新。ロック中は `429` ＋ `availableAt` |
| `DELETE /api/me` | `{password}` | **アカウント削除**。投稿・メディア・いいね・リポスト・投票・フォロー・ブロック・ブックマーク・通知・アイコン/ヘッダ・全セッションをカスケード削除 |
| `PUT /api/me/avatar` | 生 PNG（`Content-Type: image/png`） | 正方形64〜1024 |
| `PUT /api/me/header` / `DELETE /api/me/header` | 生 PNG / — | |
| `GET /api/me/sessions` | — | ログイン端末一覧 `[{id,ip,ua(生の User-Agent 文字列),createdAt,lastSeenAt,current}]`。設定画面は「OS·ブラウザ」の要約と生 UA の両方を表示 |
| `DELETE /api/me/sessions/:id` | — | 個別ログアウト |
| `DELETE /api/me/sessions` | — | 他端末を一括ログアウト |
| `GET /api/me/bookmarks` | — | ブックマークした投稿 `{entries}` |
| `GET /api/capabilities` | — | `{video:boolean}` |

### プロフィール / ソーシャルグラフ
| M・パス | 内容 |
|---|---|
| `GET /api/users/:username` | 公開プロフィール（`mail` は含めない。`followedByMe/blockedByMe/blocksMe/isMe/link/header/createdAt` を含む） |
| `GET /api/users/:username/posts` | 投稿＋リポストを新しい順 `{entries}`（相互ブロック時は空） |
| `GET /api/users/:username/likes` | いいねした投稿 `{entries}` |
| `POST\|DELETE /api/users/:username/follow` | フォロー / 解除（ブロック関係があると `403`） |
| `POST\|DELETE /api/users/:username/block` | ブロック / 解除（ブロック時に相互フォローを解除） |
| `GET /api/avatar/:userId` / `GET /api/header/:userId` | PNG 配信 |

### 投稿・タイムライン
| M・パス | 内容 |
|---|---|
| `GET /api/posts?feed=recommended\|following&since=<ms>` | `{ok,feed,entries}`。`since` 指定でそれより新しいものだけ（新着ポスト通知に使用）。ブロックしたユーザーは除外 |
| `POST /api/posts` | `{text, replyTo?, media?:[{id}], poll?:{options[],durationMinutes}}` → `201 {post}`。メディアと投票は排他、動画は1本のみ |
| `GET /api/posts/:id` | `{parents[],post,replies[]}` |
| `DELETE /api/posts/:id` | 本人のみ。子孫・メディア・関連通知/ブックマークをカスケード削除 |
| `POST\|DELETE /api/posts/:id/like` | `{liked,likeCount}` |
| `POST\|DELETE /api/posts/:id/repost` | `{reposted,repostCount}` |
| `POST\|DELETE /api/posts/:id/bookmark` | `{bookmarked}` |
| `POST /api/posts/:id/vote` | `{option:index}` → `{poll}`。二重投票・締切後は `400` |

`entries` 要素: `{ kind:"post"|"repost", sortAt, repostedBy?, post }`。
`post`: `{ id,text,createdAt,replyTo, author{userId,name,handle,avatar}, hashtags[], media[{type,id,url,width,height}], poll{options[{text,votes}],totalVotes,endsAt,closed,myVote}, likeCount,repostCount,replyCount, likedByMe,repostedByMe,bookmarkedByMe,mine }`

### メディア
| M・パス | 内容 |
|---|---|
| `POST /api/media/image` | 生 PNG → 検証・保存 → `{media:{type:"image",id,width,height}}` |
| `POST /api/media/video` | 生バイト → ffmpeg 変換 → `{media:{type:"video",id}}`（ffmpeg 無しは `501`） |
| `GET /api/media/:file` | 保存済みメディア配信（`uuid.(png\|mp4)` のみ許可・パス確認あり） |

### 通知 / 検索 / トレンド
| M・パス | 内容 |
|---|---|
| `GET /api/notifications` | `{notifications:[{id,type,createdAt,read,actor,post}],unreadCount}` |
| `POST /api/notifications/read` | 全既読 |
| `GET /api/search?q=` | `#` 始まりはタグ一致、それ以外は本文部分一致。`{query,kind,posts[]}` |
| `GET /api/trends` | 直近7日（無ければ全期間）のハッシュタグ上位10 `{trends:[{tag,count}]}` |

---

## 7. 画面の機能

- **ログイン / 登録** — 成功で `/home` へ（登録は自動ログイン）。
- **ホーム** — おすすめ / フォロー中タブ。投稿ボックス（本文・画像最大4・動画・投票2〜4択・絵文字ピッカー）。60秒ごとに「新しいポストをN件表示」ボタンが出て、押すと差分を先頭に追加。各投稿でいいね・リポスト・返信・ブックマーク・共有（リンクコピー）・自投稿削除。
- **プロフィール `/<username>`** — ヘッダ画像・アイコン・表示名・@・自己紹介・外部リンク・利用開始日・フォロー/フォロワー数。フォロー切替、`…` からブロック、本人は「プロフィールを編集」（表示名・bio・リンク・アイコン・ヘッダ）。ポスト / いいね タブ。
- **投稿詳細 `/status/:id`** — 親スレッド → 対象投稿 → 返信ボックス（画像・投票・絵文字対応）→ 返信一覧。
- **検索 `/search`** — キーワード / `#タグ`。クエリ未指定時はトレンドを表示。
- **通知 `/notifications`** — 一覧。開くと既読化しバッジ解消。
- **ブックマーク `/bookmarks`** — ブックマークした投稿一覧。
- **設定 `/settings`** — メール変更 / パスワード変更 / **ユーザー名変更（週1・ロック中は次回可能時刻を表示）** / ログイン端末一覧（IP・端末要約・**生 User-Agent**・最終アクセス・個別/一括ログアウト）/ アカウント削除（「削除」入力＋パスワードの確認モーダル）。
- 削除・ブロック等の確認は **すべて画面内のモーダル / トースト**（`window.alert` / `confirm` は不使用）。
- **画像はライトボックスでプレビュー**：投稿画像・プロフィールのアイコン/ヘッダ・投稿前の添付画像・API 経由の画像（`/api/media` `/api/avatar` `/api/header`）はクリックで**画面手前にオーバーレイ表示**（別タブへ遷移しない、Esc / 背景クリックで閉じる）。プロフィール編集はアイコン/ヘッダを**保存前にプレビュー**し、「保存」で確定。
- サイドバー・右カラム・トレンドは `common.js` が各ページへ注入する。

---

## 8. セキュリティ / 運用

- **CSP**: `default-src 'self'` を基本に、スタイルとフォントのみ Google Fonts / cdnjs を許可。`script-src 'self'`（インラインスクリプトなし）、`img-src 'self' data: blob:`、`media-src 'self' blob:`、`frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'`。
- **レート制限**: 全 `/api` は 1IP 毎分500。`login` / `register` / `me/password` / `me/email` は毎分20。
- **CSRF 多層防御**: `SameSite=Lax` Cookie ＋ `Sec-Fetch-Site: cross-site` の書き込みを拒否 ＋ JSON/`image/png` の Content-Type 要求（クロスサイトからは preflight が必要で送れない）。
- **アップロード**: 生バイトは経路ごとにサイズ上限（画像9MB / 動画85MB）。PNG はシグネチャ・IHDR 寸法・サイズを検証（デコードしない）。動画は ffmpeg を引数配列で spawn し `-map_metadata -1`、タイムアウトあり。保存ファイル名はサーバー生成。配信は `uuid.(png|mp4)` 限定＋実パス確認でトラバーサル防止。動画変換は専用レート制限（15分に6回/IP）＋同時実行数の上限（既定2）で CPU 枯渇を防止。
- **セッション**: Cookie にはランダムトークンのみ、DB は sha256 のみ保持。失効機構あり。不正な `%` エンコーディングを含む Cookie は例外を投げず無視する。
- **秘匿**: `X-Powered-By` 無効、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Cross-Origin-Resource-Policy: same-origin`。エラー時はスタックトレースを返さずログのみ。公開プロフィール・投稿・通知にメールを含めない。端末一覧の IP/UA は本人にのみ。
- **入力**: JSON ボディ ≤32KB。本文280 / 表示名50 / bio160 / link100、userId は英数字と `_`。ハッシュタグは `\p{L}\p{N}_` のみ（`<>"` 等を含めない）。
- **本番**: `NODE_ENV=production` かつ `dist/` があれば minify 済みを配信。`npm run prod` で `build` → 起動。Node は本番では既定で `127.0.0.1`（ループバック）のみ待受け、リバースプロキシ経由のみを前提とする（`trust proxy` は1ホップのみ信頼。Node に直接到達できると `X-Forwarded-For` 偽装でレート制限を回避されるため）。**クラウド Gateway + 自宅 Origin 構成**（`GATEWAY_SECRET` 設定時）では、共有シークレットを持たないリクエストを Origin 側で `403` 拒否したうえで、Gateway が計算済みの実クライアントIP（`X-Origin-Client-Ip`）を `X-Forwarded-For` に採用し直すことで、なりすまし不可能な形で1ホップ信頼を維持する。手順は [DEPLOY.md](DEPLOY.md)。

### 既知の制限
- データストアは JSON ファイル。書き込みは一時ファイル+rename で原子的だが、プロセスを跨いだロックは無い。**単一 Node プロセスでの運用を前提**とし、クラスタモードや複数インスタンスへの水平分散はしない（[DEPLOY.md](DEPLOY.md) 参照）。
- リポストのタイムライン展開は「フォロー中」フィードとプロフィールのみ。
- 登録・メールアドレス変更にメール確認（本人所有性の検証）は無い。
- DM・引用リポスト・画像の alt・トレンドの地域別集計・通知の粒度設定は未実装。

---

## 9. セットアップ

```bash
npm install
npm start        # 開発  → http://localhost:3000
npm run prod     # 本番  → dist/ を生成し NODE_ENV=production で起動
```

動画投稿を有効にするには `ffmpeg` を PATH に置く（または `FFMPEG_PATH` を設定）。

本番環境（クラウド Gateway + 自宅 Origin を Cloudflare Tunnel で結ぶ構築手順・systemd サービス例・環境変数一覧）は [DEPLOY.md](DEPLOY.md) を参照。
