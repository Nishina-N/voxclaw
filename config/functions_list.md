# スキル一覧

* **gcal_create_calendar_event**: Googleカレンダーに予定を追加します。タイトル・開始終了時刻は必須。説明・場所は省略可。
* **gcal_delete_calendar_event**: Googleカレンダーの予定を削除します。eventIdが必須です。削除前にユーザーに確認を取ってください。
* **gcal_get_calendar_events**: Googleカレンダーから予定を取得します。指定した期間（timeMin, timeMax）のイベントを取得可能です。
* **gcal_update_calendar_event**: Googleカレンダーの既存の予定を更新します。eventIdは必須。変更したい項目だけ指定すればOKです。
* **gdrv_create**: Googleドライブに新規ファイルを作成する
* **gdrv_list**: Googleドライブ内のファイルを検索・一覧化する
* **gdrv_read**: Googleドライブ上のテキストファイルの内容を読み取る
* **gdrv_update**: Googleドライブ上のファイルを更新する
* **gsheet_add_chart**: Google スプレッドシートにグラフを追加します。source_range の1列目がカテゴリ（X軸・ラベル）、残りの列がシリーズ（値）として扱われます。position を省略すると新しいシートに作成されます。
* **gsheet_append_spreadsheet**: Google スプレッドシートのデータが入っている最終行の後に新しい行を追加します。ログや記録の蓄積に適しています。valuesは2次元配列で指定します。
* **gsheet_create_spreadsheet**: Google スプレッドシートを新規作成します。タイトルは必須。シート名のリストを渡すと複数シートを初期作成できます。作成後に返されるspreadsheetIdを使って読み書きができます。
* **gsheet_delete_chart**: Google スプレッドシートのグラフを削除します。chartId は gsheet_list_charts で確認できます。削除前にユーザーに確認を取ってください。
* **gsheet_get_spreadsheet_info**: Google スプレッドシートのタイトルとシート名一覧を取得します。spreadsheet_idはURLに含まれる文字列です（例: docs.google.com/spreadsheets/d/<spreadsheet_id>/）。
* **gsheet_list_charts**: Google スプレッドシート内のグラフ一覧（chartId・title・chartType・シート名）を取得します。グラフの削除・更新前に chartId を調べるときに使います。
* **gsheet_read_spreadsheet**: Google スプレッドシートの指定範囲のセル値を取得します。rangeはA1記法で指定します（例: 'Sheet1!A1:C10'、'A1:B5'）。
* **gsheet_update_chart**: Google スプレッドシートの既存グラフのスペック（タイトル・凡例・軸・色など）を更新します。【重要】updateChartSpec はスペック全体の置き換えになるため、先に gsheet_list_charts でスペックを取得し、変更したいフィールドをマージして渡してください。代表的なフィールド: title（タイトル）、basicChart.legendPosition（凡例位置: BOTTOM_LEGEND / TOP_LEGEND / RIGHT_LEGEND / NO_LEGEND）、basicChart.stackedType（積み上げ: NOT_STACKED / STACKED / PERCENT_STACKED）、basicChart.series[].color（系列の色 { red, green, blue }）、pieChart.pieHole（ドーナツ比率 0.0〜1.0）。
* **gsheet_write_spreadsheet**: Google スプレッドシートの指定範囲にデータを書き込みます（既存のデータを上書き）。valuesは2次元配列で指定します。数式や日付を自動解釈したい場合はvalue_input_optionを'USER_ENTERED'に設定してください（デフォルト）。
* **local_task_create_task**: ローカルタスクを新規作成します。タイトルは必須。メモ・期日は省略可。
* **local_task_delete_task**: ローカルタスクを削除します。idは必須。削除前にユーザーに確認を取ってください。
* **local_task_get_tasks**: ローカルタスクの一覧を取得します。statusで未完了／完了済みの絞り込みが可能。省略で全件取得。
* **local_task_update_task**: ローカルタスクを更新します。完了マーク・タイトル変更・期日変更などに使います。idは必須。
* **map_get_location**: 場所名や住所から緯度と経度を取得するツール。実行: 指定された文字列をGeocoding APIで検索。成功時: 緯度経度のデータオブジェクトを返却。失敗時: 理由を含んだエラーメッセージを出力。このツールはステートレスであり、正常終了時は再実行不要。
* **map_get_mapbox_map**: Mapbox APIを使用して地図画像を取得する。マーカーは `pin-l-数字+色(経度,緯度)` の形式で指定する。複数のピンを一度にマッピングする場合、それらをカンマ区切りで一度の呼び出しに含めること（例: pin-l-1+ff0000(135.75,34.98),pin-l-2+ff0000(135.76,34.99)）。成功時: 画像をローカルの絶対パス(文字列)に保存し、パスを返却。APIエラー時は422等の原因を含めてレポート。正常終了時は画像が指定パスに保存されている。再実行は不要。
* **util_get_today_date**: 現在の日付（UTC基準、YYYY年MM月DD日）を取得する。
* **util_memory_search**: 記憶ファイル（/app/memory/）をSQLite FTS5（BM25）で全文検索します。過去の会話・メモ・記録から関連情報を探す際に使用。特定のファイルをread_memoryで読む前に、まずこのツールで関連記憶を探してください。追加依存なし・即時起動。
* **util_run_python**: サーバー内の既存Pythonファイルを実行する。前提: 指定した絶対パスにファイルが存在し、読み取り権限があること。動作: Python 3インタプリタで実行。成功時: 標準出力を返す。エラー時: 実行エラーやファイル非存在エラーを詳細に報告する。用途: 定型的なスクリプトや保存済みプログラムの実行。
* **util_run_python_code**: メモリ上でPythonコード断片を即時実行する。前提: 外部ファイル不要。動作: 渡された文字列をPythonコードとして実行し、標準出力を返す。成功時: 実行結果を文字列として返す。エラー時: 例外内容を報告。用途: データ加工、一時的な計算、ロジックテスト。
* **util_send_image_to_discord**: 指定されたパスにある画像ファイルをDiscordの指定チャンネルに送信するツール。チャンネルIDは、各メッセージの冒頭に含まれる [Channel ID: <ID>] から取得し、それを指定すること。実行前条件: 指定パスに画像ファイルが存在すること。動作: Discord APIにファイルをPOST。成功時: Discord APIからのレスポンス結果を返却。失敗時: エラーメッセージを出力。
* **util_update_functions_list**: スキルのディレクトリから一覧を取得し、/app/config/skills_list.md を更新する
* **util_web_search**: Brave Search APIを使用してWeb検索を行い、検索結果を返します。目的: 情報調査。動作: クエリに基づきネット検索を行う。エラー時: 検索失敗の理由を出力。正常終了時は再実行不要。
