---
"cron-explain-ja": patch
---

README のリリース手順から誤った記述を削除した。npm の publish が 404 になる原因を
「Granular Access Token では新規パッケージを作成できない」と説明していたが、実際は
`NODE_AUTH_TOKEN` の渡し漏れであり、トークンの種類とは無関係だった。
