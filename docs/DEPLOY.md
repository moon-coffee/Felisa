# 本番環境構築（自宅内 Gateway + 自宅内 Origin、Cloudflare Tunnel 経由・クラウド VPS 不要）

Felisa を **Gateway（公開の受け口）と Origin（＝データの正本）に分離**して公開する手順。
**クラウド VPS は使わない。** サーバーは 2 台に分けるが、どちらも自宅内（同一 LAN）に置く。

```
ブラウザ
  │  https://your-domain.com
  ▼
Cloudflare（DNS / CDN / TLS 終端。ここで HTTPS を終端する）
  ▲
  │  Cloudflare Tunnel（cloudflared のアウトバウンド接続のみ・ポート開放不要・固定IP/DDNS 不要）
  │
自宅マシンA = Gateway: cloudflared → Gateway(Node, 127.0.0.1:8080)
  │  実ファイルの静的資産（/js, /Images, /style.css, /home.css）はここで直接返す
  │  それ以外（HTML シェル・/api/* 全部）は下へ転送
  ▼  自宅 LAN（http://<マシンBのLAN IP>:3000、GATEWAY_SECRET で認証）
自宅マシンB = Origin: Server(Node, LAN 待受:3000)
  データ（Server/data/*）・セッション・投稿・画像/動画はすべてここが正本
```

- **Gateway（自宅マシンA）** … `Gateway/server.js`。公開ドメインを受ける常時稼働のフロント。静的資産のみ自前で配信し、残りを LAN 経由で Origin へ丸ごと転送する。データは一切持たない（ステートレス）。このマシンだけが `cloudflared` を動かし、外部と通信する。
- **Origin（自宅マシンB）** … 従来どおりの `Server/server.js`。投稿・ユーザー・セッション・アップロード画像/動画など全データの読み書きはここでのみ行う。**インターネットにも Cloudflare Tunnel にも直接つながない。** LAN 上でだけ待ち受け、`cloudflared` は動かさない。
- 2 台の間は `GATEWAY_SECRET`（共有シークレット）で認証する。加えて Origin マシンのファイアウォールで **ポート 3000 の受信を Gateway マシンの LAN IP からのみ許可**する（多層防御）。`GATEWAY_SECRET` を持たないリクエストは Origin の Node が `403` で拒否する（[Server/server.js](../Server/server.js)）。

**なぜ 2 台に分けるか。** 公開経路（`cloudflared`）を握るのは Gateway マシンだけで、Origin（データの正本）は Tunnel からも直接インターネットからも到達できない。仮に Gateway マシンが公開経路側から侵入されても、攻撃者は依然として「LAN 到達」と「共有シークレット」の両方を突破しないと Origin に触れない。1 台に同居させるとこの分離が失われる。

**VPS・ポート開放・固定IP・DDNS はいずれも不要。** Cloudflare Tunnel は Gateway マシンからの持続的なアウトバウンド接続で成立するため、自宅回線のグローバルIPが動的でもホスト名は変わらない。ルーターのポート開放も行わない。

**Caddy も不要。** HTTPS は Cloudflare 側で終端し、Cloudflare ↔ Gateway 間は `cloudflared` が張る暗号化トンネルなので、自宅側に TLS を終端するリバースプロキシは要らない。`cloudflared` が直接 Gateway の `127.0.0.1:8080` へ流す。

以下、`your-domain.com` はプレースホルダ。実際に取得したドメインに読み替えること。

---

## 1. ドメインの取得・Cloudflare への登録

まだ取得していない場合、レジストラでドメインを取得する。DNS を **Cloudflare** で管理する（Cloudflare Tunnel を使うため、DNS は Cloudflare 必須）。別レジストラで取得した場合も、ネームサーバーを Cloudflare 側の指示に沿って切り替える。

このあと `cloudflared tunnel route dns` を実行すると、`your-domain.com` に対する **CNAME（Proxied／オレンジクラウド）** が自動で作成される。手動で A レコードを作る必要はない。VPS が無いので指し先のグローバルIPも用意しない。

## 2. 自宅マシン 2 台の準備（同一 LAN）

同じ LAN に 2 台のマシンを用意する（物理マシンでも、別筐体の VM でもよい。最低限、電源とネットワークが安定していること）。

- **マシンA（Gateway 役）**: `cloudflared` と `Gateway/server.js` を動かす。
- **マシンB（Origin 役）**: `Server/server.js` を動かす。データはこのマシンのディスクに置く。

それぞれの LAN IP を固定する（ルーターの DHCP 予約、または OS 側の静的IP設定）。以降の手順では例として次を使う:

| 役割 | 例の LAN IP |
|---|---|
| マシンA（Gateway） | `192.168.1.10` |
| マシンB（Origin） | `192.168.1.20` |

LAN IP が変わると `ORIGIN_URL` とファイアウォール設定を直す必要があるため、必ず固定すること。

## 3. Gateway マシン（マシンA）に cloudflared を導入

`cloudflared` は **Gateway マシンにだけ**入れる。Origin マシンには入れない。

```bash
# Debian/Ubuntu系
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Cloudflare アカウントで認証（ブラウザが開き、対象ドメインを選択する）
cloudflared tunnel login

# トンネル作成
cloudflared tunnel create felisa
# => Tunnel credentials written to /root/.cloudflared/<TUNNEL-ID>.json

# 公開ドメインをこのトンネルにルーティング（CNAME が自動作成される）
cloudflared tunnel route dns felisa your-domain.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: felisa
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: your-domain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

`cloudflared` は Gateway と同じマシンのループバック（`127.0.0.1:8080`）だけを見る。Origin へは一切ルーティングしない。

> **アップロード上限**: Cloudflare のプロキシ経由（Tunnel 含む）はリクエストボディが **100MB** までに制限される（Free/Pro）。Felisa の動画上限は 80MB（生バイト受信上限 85MB）なのでこの範囲に収まる。上限を上げたい場合は Cloudflare のプラン制約になる。

## 4. 前提条件（両マシン共通）

- Node.js 18 LTS 以降（`crypto.randomUUID` / `base64url` エンコーディングを使用）
- Caddy は **不要**（クラウド版の手順と異なる点）
- （任意）`ffmpeg`（動画投稿を使う場合のみ。**Origin マシンに**入れる。PATH に置くか `FFMPEG_PATH` で指定）

## 5. 取得・依存関係・ビルド（両マシンで実施）

同じリポジトリを **マシンA** と **マシンB** の両方に配置する。`dist/`（minify 済み静的資産）は Gateway が JS/CSS/画像の配信に使い、Origin は HTML シェルの配信に使うため、どちらのマシンでもビルドが必要。

```bash
git clone <このリポジトリ> /opt/felisa
cd /opt/felisa
npm ci                  # package-lock.json に固定されたバージョンで再現性のあるインストール
npm run build           # Client/ を minify して dist/ を生成
```

## 6. 共有シークレットの生成

Gateway と Origin の両方に同じ値を設定する。第三者に推測不能な十分に長いランダム文字列にする。

```bash
openssl rand -hex 32
```

## 7. 環境変数

### Gateway（マシンA）

| 変数 | 既定値 | 説明 |
|---|---|---|
| `NODE_ENV` | — | `production` を指定 |
| `PORT` | `8080` | Gateway が待ち受けるポート（`cloudflared` の `config.yml` の指し先と一致させる） |
| `HOST` | `127.0.0.1` | Gateway の待受アドレス。`cloudflared` と同じマシンなのでループバックのままでよい |
| `ORIGIN_URL` | — （必須） | Origin マシンの LAN アドレス。例 `http://192.168.1.20:3000`（LAN 内なので `http` でよい） |
| `GATEWAY_SECRET` | — （本番は必須） | §6 で生成した共有シークレット |

### Origin（マシンB）

| 変数 | 既定値 | 説明 |
|---|---|---|
| `NODE_ENV` | — | `production` を指定。`dist/` があればそちらを配信し、Cookie に `Secure` が付く |
| `PORT` | `3000` | Node が待ち受けるポート |
| `HOST` | 本番は `127.0.0.1` / 開発は全インターフェース | **この構成では明示指定が必要。** Gateway が別マシンから接続するため `0.0.0.0`（または自マシンの LAN IP `192.168.1.20`）にする。第三者到達はファイアウォール（§9）と `GATEWAY_SECRET` で防ぐ |
| `GATEWAY_SECRET` | — （設定すると有効化） | §6 で生成した共有シークレット。**Gateway 側と同じ値**にする。未設定だと従来どおりの単体構成として動く |
| `FFMPEG_PATH` | `ffmpeg`（PATH から解決） | ffmpeg のフルパスを固定したい場合に指定 |

`.env` ファイルの読み込み機構は無いため、systemd の `Environment=` かシェルの `export` で設定する。

## 8. systemd サービス

### 8-1. Origin（マシンB: `Server/server.js`）

`/etc/systemd/system/felisa.service`:

```ini
[Unit]
Description=Felisa Origin (Node.js, データの正本)
After=network.target

[Service]
Type=simple
User=felisa
WorkingDirectory=/opt/felisa
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=GATEWAY_SECRET=<§6で生成した値>
ExecStart=/usr/bin/node Server/server.js
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/felisa/Server/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin felisa
sudo chown -R felisa:felisa /opt/felisa
sudo systemctl daemon-reload
sudo systemctl enable --now felisa
sudo systemctl status felisa
```

### 8-2. Gateway（マシンA: `Gateway/server.js`）

`/etc/systemd/system/felisa-gateway.service`:

```ini
[Unit]
Description=Felisa Gateway (自宅内フロント・データは持たない)
After=network.target

[Service]
Type=simple
User=felisa
WorkingDirectory=/opt/felisa
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=ORIGIN_URL=http://192.168.1.20:3000
Environment=GATEWAY_SECRET=<§6で生成した値。Origin 側と同じ>
ExecStart=/usr/bin/node Gateway/server.js
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin felisa
sudo chown -R felisa:felisa /opt/felisa
sudo systemctl daemon-reload
sudo systemctl enable --now felisa-gateway
sudo systemctl status felisa-gateway
```

### 8-3. Gateway（マシンA: cloudflared）

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

**Origin・Gateway とも単一プロセスで運用すること。** `pm2 -i max` のようなクラスタモードや複数インスタンスの水平分散は行わない。データストアが `Server/data/*.json` へのファイル書き込み（プロセス内では原子的だが、プロセスを跨いだロックは無い）のため、複数プロセスが同じファイルへ同時に書き込むと競合が起こり得る。アクセスが増えて水平分散が必要になった場合は、先にデータストアを DB に置き換えること（Gateway は元々ステートレスなので複数台に増やして構わない）。

## 9. Origin マシンのファイアウォール（マシンB）

`GATEWAY_SECRET` に加えて、**ポート 3000 の受信を Gateway マシンからのみ**に絞る。

```bash
# ufw の例（マシンB で実行）
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.10 to any port 3000 proto tcp   # Gateway マシンのみ許可
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp   # SSH 管理する場合（LAN 内のみ）
sudo ufw enable
```

Gateway マシン（マシンA）は `cloudflared` がアウトバウンド接続のみで動くため、インバウンドを一切開けなくてよい（SSH 等の管理ポートを除く）。ルーターのポート開放も両マシンとも不要。

## 10. データのバックアップ（Origin マシンのみ）

`Server/data/`（`.gitignore` 対象。`admin.json` のみ追跡）が全データの実体。Gateway はデータを持たないためバックアップ対象外。

```bash
tar czf "felisa-data-$(date +%Y%m%d%H%M).tar.gz" -C /opt/felisa/Server data
```

2 台とも自宅にあるため、**自宅の外**（クラウドストレージ・勤務先・実家の NAS など）にも定期コピーすることを強く推奨する。サービス停止中（またはアクセスが少ない時間帯）に取得するのが安全。稼働中に取得する場合、書き込みは一時ファイル+rename方式のため「読み取り中に壊れた JSON を掴む」リスクはないが、複数ファイル間の整合性（例: 投稿削除の途中）までは保証されない。

## 11. デプロイの更新手順

**Gateway（マシンA）:**

```bash
cd /opt/felisa
git pull
npm ci
npm run build
sudo systemctl restart felisa-gateway
```

**Origin（マシンB）:**

```bash
cd /opt/felisa
git pull
npm ci
npm run build
sudo systemctl restart felisa
```

`cloudflared` の設定（`config.yml`）はコード変更では変わらないため、通常は再起動不要。

## 12. 動作確認

```bash
curl -s https://your-domain.com/api/capabilities
# => {"ok":true,"video":true|false}
```

`video:false` の場合は Origin マシンに `ffmpeg` が無い（PATH を確認、または `FFMPEG_PATH` を設定して再起動）。

Origin が Gateway 経由以外から到達できないことも確認する。LAN 内の別マシンから共有シークレット無しで叩くと 403 になるはず:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.20:3000/api/capabilities
# => 403
```

さらに、Gateway マシン以外の LAN IP からはファイアウォールで接続自体が弾かれること（タイムアウト／`Connection refused`）も確認する。

証明書の状態確認には [SSL Labs](https://www.ssllabs.com/ssltest/) 等の外部サービスも利用できる（証明書は Cloudflare が管理する）。

## 13. Windows で動かす場合（参考）

各マシンで Node をサービス化するには [NSSM](https://nssm.cc/) 等を使う。

```powershell
# マシンB（Origin）
nssm install FelisaOrigin "C:\Program Files\nodejs\node.exe" "Server\server.js"
nssm set FelisaOrigin AppDirectory "C:\path\to\Web"
nssm set FelisaOrigin AppEnvironmentExtra NODE_ENV=production PORT=3000 HOST=0.0.0.0 GATEWAY_SECRET=<値>
nssm start FelisaOrigin

# マシンA（Gateway）
nssm install FelisaGateway "C:\Program Files\nodejs\node.exe" "Gateway\server.js"
nssm set FelisaGateway AppDirectory "C:\path\to\Web"
nssm set FelisaGateway AppEnvironmentExtra NODE_ENV=production PORT=8080 ORIGIN_URL=http://192.168.1.20:3000 GATEWAY_SECRET=<値>
nssm start FelisaGateway
```

`cloudflared` は Windows 版バイナリがあり、マシンA で `cloudflared.exe service install` → サービス起動で §3 と同じ `config.yml`（`127.0.0.1:8080` 指し）を使える。Windows ファイアウォールでは「受信の規則」でポート 3000 を Gateway マシンのIPのみ許可に設定する（§9 相当）。

---

## 補足: 構成を戻したい場合

- **クラウド VPS を使う構成にしたい場合**: Gateway を VPS に移し、`ORIGIN_URL` を Origin 用の Cloudflare Tunnel ホスト名にして、Origin マシンでも `cloudflared`（Origin 専用トンネル）を動かす。VPS 側で Caddy による TLS 終端が必要になる。
- **自宅 1 台の単体公開に戻したい場合**: `GATEWAY_SECRET` を設定せず、Origin マシンで `cloudflared` を動かして `your-domain.com` を直接 `127.0.0.1:3000` にルーティングする。Gateway プロセスは不要。
