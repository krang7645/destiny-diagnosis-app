// netlify/functions/analyze-result.js
exports.handler = async function(event, context) {
  // CORSヘッダーの設定
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };

  // OPTIONSリクエスト対応
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Successful preflight call" }),
    };
  }

  // GETリクエスト以外は拒否
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    // 簡易的なデモデータ（実際の運用では、データベースに保存・取得する仕組みが必要）
    const resultId = event.path.split('/').pop();

    const demoData = {
      destiny: `デモユーザーさんの天命診断結果...`,
      reincarnations: [
        {
          name: "デモ人物1",
          years: "YYYY-YYYY",
          reasons: [
            "**特性1**：詳細説明",
            "**特性2**：詳細説明",
            "**特性3**：詳細説明",
            "**特性4**：詳細説明"
          ],
          conclusion: "→ **「キーポイント」**の点で共通点があります！"
        },
        // 他の人物も同様に
      ]
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(demoData)
    };

  } catch (error) {
    console.error("エラー:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "結果の取得中にエラーが発生しました",
        message: error.message
      }),
    };
  }
};