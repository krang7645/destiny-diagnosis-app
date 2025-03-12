const { Configuration, OpenAIApi } = require("openai");

// サーバーレス関数のハンドラー
exports.handler = async function(event, context) {
  // CORSヘッダーの設定
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // OPTIONSリクエスト（プリフライトリクエスト）への対応
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Successful preflight call" }),
    };
  }

  // POSTリクエスト以外は拒否
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    // リクエストボディからデータを取得
    const data = JSON.parse(event.body);
    const { name, birthdate, mbti } = data;

    // バリデーション
    if (!name || !birthdate || !mbti) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "必須パラメータが不足しています" }),
      };
    }

    // OpenAI APIの設定
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // キーが設定されていない場合のエラーハンドリング
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "OpenAI APIキーが設定されていません" }),
      };
    }

    const openai = new OpenAIApi(configuration);

    // ChatGPT APIへのプロンプト
    const prompt = `
あなたは運命診断の専門家です。以下の情報を元に、この人物の天命と前世を3つ診断してください。
回答はJSON形式で返してください。

【入力情報】
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

【診断内容】
1. この人物の名前の字画、星座、MBTIから導き出される「天命」
2. この人物の前世と思われる歴史上の人物3名。それぞれについて以下を含めてください:
   - 名前と生年没年
   - その人物が前世である理由（4点、各理由は太字でハイライト）
   - 結論（→ で始まる一文）

【出力形式】
{
  "destiny": "天命の詳細なテキスト",
  "reincarnations": [
    {
      "name": "歴史上の人物1",
      "years": "生年-没年",
      "reasons": [
        "**太字にする理由1**：詳細説明",
        "**太字にする理由2**：詳細説明",
        "**太字にする理由3**：詳細説明",
        "**太字にする理由4**：詳細説明"
      ],
      "conclusion": "→ **「キーワード」**の点で共通点があります！"
    },
    // 人物2, 人物3も同様の形式
  ]
}

必ずJSON形式で返してください。JSONの構造は上記の通りに厳密に従ってください。
`;

    // OpenAI APIにリクエスト
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "あなたは運命診断の専門家です。回答はJSON形式で返してください。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
    });

    // レスポンスからJSONを抽出
    const content = response.data.choices[0].message.content;
    
    // JSON部分を抽出する正規表現パターン
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("APIからの応答をJSON形式で解析できませんでした");
    }
    
    let resultData;
    try {
      resultData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error("JSONのパースに失敗しました: " + e.message);
    }

    // 結果ID（単純なタイムスタンプ）
    const resultId = Date.now().toString();
    
    // 成功レスポンス
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...resultData,
        resultId
      }),
    };
  } catch (error) {
    console.error("エラー:", error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "診断処理中にエラーが発生しました", 
        message: error.message 
      }),
    };
  }
};
