const { Configuration, OpenAIApi } = require("openai");

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

    // OpenAI APIの設定 (v3系の構文)
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

    // プロンプトは診断指示のみとし、具体的な診断内容はLLMに任せる
    const prompt = `
あなたは占いの専門家です。依頼者の情報をもとに、その人の「天命」と「前世」を詳細に診断してください。
回答はマークダウン形式で提供し、太字や箇条書きなどを使って読みやすく整形してください。

【依頼者情報】
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

【診断内容】
まず、依頼者の名前、生年月日、MBTIから「天命」を分析してください。以下の要素を含めてください：
- 生年月日から導き出される星座とその特性
- MBTIタイプの基本的特徴と向いている分野
- 数秘術による運命数と使命
- 姓名判断（画数分析、音の響き、漢字の意味など）
- これらを総合して導き出される「天命」

次に、その天命に基づいて、この人物の「前世」として考えられる歴史上の人物を3名挙げてください。各人物について：
- 名前と生没年
- その人物が前世である理由を太字付きの箇条書きで4点
- 結論（→ で始まる一文）

すべての解析は、小松竜之介（1990年7月31日生まれ、ESFP）の例のようなフォーマットと詳細さで行ってください。
`;

    try {
      // OpenAI API呼び出し (v3系の構文)
      const response = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "あなたは占い・姓名判断・運命診断の専門家です。依頼者の情報を元に詳細な天命と前世の分析をします。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      // 応答テキストを取得
      const content = response.data.choices[0].message.content;

      // テキスト形式の応答を構造化
      const parts = content.split(/(?=##|\n#)/);

      // 天命の部分を抽出
      const destiny = parts[0].trim();

      // 前世の部分を抽出して解析
      const reincarnationsText = content.split(/前世|歴史上の人物/)[1] || "";

      // 正規表現で前世の人物を抽出
      const personMatches = reincarnationsText.match(/(?:\d+\.|\*\*\d+\.\s+|\*\*\d+\.\*\*\s+)(.*?)(?:\n|\r|$)(?:[\s\S]*?)→(.*?)(?=\n\s*\d+\.|\n\s*\*\*\d+\.|\*\*\d+\.\*\*|\s*$)/g);

      const reincarnations = [];

      if (personMatches) {
        personMatches.forEach((match, index) => {
          // 名前と年を抽出
          const nameMatch = match.match(/(?:\d+\.|\*\*\d+\.\s+|\*\*\d+\.\*\*\s+)(.*?)(?:\(|\（)(.*?)(?:\)|\）)/);

          // 理由を抽出（箇条書きの項目）
          const reasonsMatch = match.match(/(?:\*|\-)\s+(.*?)(?:\n|$)/g);

          // 結論を抽出
          const conclusionMatch = match.match(/→\s+(.*?)(?:\n|$)/);

          if (nameMatch) {
            const name = nameMatch[1].trim();
            const years = nameMatch[2].trim();

            const reasons = reasonsMatch ?
              reasonsMatch.map(r => r.replace(/(?:\*|\-)\s+/, '').trim()) :
              [];

            const conclusion = conclusionMatch ?
              conclusionMatch[1].trim() :
              "";

            reincarnations.push({
              name,
              years,
              reasons,
              conclusion
            });
          }
        });
      }

      // 不足がある場合はダミーデータを追加
      while (reincarnations.length < 3) {
        const index = reincarnations.length + 1;
        reincarnations.push({
          name: `歴史上の人物${index}`,
          years: "不明",
          reasons: [
            "理由1：詳細な説明が得られませんでした",
            "理由2：詳細な説明が得られませんでした",
            "理由3：詳細な説明が得られませんでした",
            "理由4：詳細な説明が得られませんでした"
          ],
          conclusion: "→ 詳細な結論は得られませんでした"
        });
      }

      // 結果ID
      const resultId = Date.now().toString();

      // 成功レスポンス
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          destiny,
          reincarnations,
          resultId
        }),
      };
    } catch (apiError) {
      console.error("API呼び出しエラー:", apiError);

      // エラー応答
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "診断処理中にエラーが発生しました",
          message: apiError.message
        }),
      };
    }
  } catch (error) {
    console.error("エラー:", error);

    // エラー応答
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