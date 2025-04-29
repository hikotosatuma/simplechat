#lambda/index.py
import json
import urllib.request

# FastAPIサーバーのエンドポイントURLを直接指定
API_URL = "https://57fe-34-148-134-235.ngrok-free.app/generate"

def lambda_handler(event, context):
    try:
        # 1) リクエストボディを取得・解析
        body = json.loads(event.get("body", "{}"))
        message = body.get("message", "")
        conversation_history = body.get("conversationHistory", [])

        # 2) FastAPIに送信するデータを作成
        payload = {
            "prompt": message,
            "max_new_tokens": 512,
            "do_sample": True,
            "temperature": 0.7,
            "top_p": 0.9
        }
        data = json.dumps(payload).encode("utf-8")

        # 3) FastAPIの /generate エンドポイントへリクエスト送信
        req = urllib.request.Request(
            API_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req) as response:
            resp_json = json.loads(response.read())

        # 4) 応答から生成テキストを取り出す
        generated_text = resp_json.get("generated_text", "")

        # 5) 会話履歴に新しいメッセージを追加
        updated_history = conversation_history + [
            {"role": "user", "content": message},
            {"role": "assistant", "content": generated_text}
        ]

        # 6) 正常レスポンスを返す
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            "body": json.dumps({
                "success": True,
                "response": generated_text,
                "conversationHistory": updated_history
            })
        }

    except Exception as e:
        # エラー時のレスポンス
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            "body": json.dumps({
                "success": False,
                "error": str(e)
            })
        }
