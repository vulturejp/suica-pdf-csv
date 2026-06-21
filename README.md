# Suica PDF CSV

モバイルSuicaの残高ご利用明細PDFをCSVへ変換する静的アプリです。

Demo: https://vulturejp.github.io/suica-pdf-csv/

## 特徴

- PDFファイルや抽出結果を外部サーバーへ送信しません。
- 変換処理はブラウザ内で完結します。
- GitHub Pages にそのまま配置できます。
- PDF解析には同梱した固定バージョンの PDF.js を使います。
- ビルド手順は不要です。

## 使い方

ローカル確認:

```bash
python3 -m http.server 8000
```

その後、`http://localhost:8000` を開いてPDFを選択します。GitHub Pagesにデプロイした場合も同じ操作です。

CSV列:

```csv
month,day,type1,station1,type2,station2,balance,amount,raw
```

## GitHub Pages

1. このリポジトリをGitHubへpushします。
2. Settings > Pages を開きます。
3. Sourceに `Deploy from a branch` を選び、公開ブランチと `/root` を指定します。

## Design

共通UIは `styles.css` にまとめています。別の小ツールを作る場合は、まず `styles.css` を読み込み、アプリ固有の調整だけを別CSSで追加します。

```html
<link rel="stylesheet" href="./styles.css" />
<link rel="stylesheet" href="./your-app.css" />
```

## License

このプロジェクトは GNU Affero General Public License v3.0 or later で配布します。PDF.js は Apache License 2.0 のサードパーティ依存として `vendor/pdfjs/` に同梱しています。
