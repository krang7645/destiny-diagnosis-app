const { OpenAI } = require("openai");

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
    const openai = new OpenAI({
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

    // プロンプトを簡素化して応答速度を上げる
    const prompt = `
以下の情報から運命診断をJSONで返してください。
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

出力形式:
{
  "destiny": "天命の説明（1段落）",
  "reincarnations": [
    {"name": "人物1名前", "years": "生没年", "reasons": ["理由1", "理由2", "理由3", "理由4"], "conclusion": "結論"},
    {"name": "人物2名前", "years": "生没年", "reasons": ["理由1", "理由2", "理由3", "理由4"], "conclusion": "結論"},
    {"name": "人物3名前", "years": "生没年", "reasons": ["理由1", "理由2", "理由3", "理由4"], "conclusion": "結論"}
  ]
}`;

    // API呼び出しを最適化
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "あなたは運命診断の専門家です。回答は必ず指定されたJSON形式で簡潔に返してください。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.5,  // より決定論的に
      max_tokens: 800,   // トークン数を制限
      timeout: 8000      // 8秒でタイムアウト
    });

    // 応答テキストを取得
    const content = response.choices[0].message.content;

    // JSONを解析してみる
    try {
      const resultData = JSON.parse(content);

      // 結果ID
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
    } catch (jsonError) {
      // JSONパースエラー時のフォールバック処理
      console.error("JSONパースエラー:", jsonError);

      // テキスト内からJSONを抽出する試み
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const extractedData = JSON.parse(jsonMatch[0]);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ...extractedData,
              resultId: Date.now().toString()
            }),
          };
        } catch (e) {
          throw new Error("JSONの抽出とパースに失敗しました");
        }
      } else {
        // 最終手段: 手動でJSONを構築
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            destiny: "あなたの名前、生年月日、MBTIから、独創的で情熱的な天命が導き出されました。新しいアイデアを形にする才能と、人々を導く力を持っています。",
            reincarnations: [
              {
                name: "レオナルド・ダ・ヴィンチ",
                years: "1452-1519",
                reasons: [
                  "**多才な創造性**：芸術から科学まで幅広い分野で才能を発揮",
                  "**先進的な思考**：時代を先取りした発明と考察",
                  "**観察力と分析力**：物事の本質を見抜く鋭い目",
                  "**完成よりも探求を重視**：常に新しいことに挑戦し続けた姿勢"
                ],
                conclusion: "→ **「好奇心と創造性」**においてあなたの魂と通じるものがあります！"
              },
              {
                name: "クレオパトラ",
                years: "紀元前69-30",
                reasons: [
                  "**卓越した知性と戦略**：複数の言語を操り、政治的手腕を発揮",
                  "**カリスマ性**：強大な帝国の指導者たちを魅了する魅力",
                  "**芸術と科学への理解**：文化的教養の高さ",
                  "**強い意志と決断力**：困難な状況下での冷静な判断"
                ],
                conclusion: "→ **「知性と魅力を武器に歴史を動かした」**点であなたとの共通点が見られます！"
              },
              {
                name: "ガンジー",
                years: "1869-1948",
                reasons: [
                  "**非暴力の哲学**：平和的な方法で大きな変革を成し遂げた",
                  "**揺るぎない信念**：困難に直面しても自分の価値観を貫いた",
                  "**シンプルな生活様式**：物質的なものよりも精神的な豊かさを重視",
                  "**包容力**：異なる意見や背景を持つ人々を尊重する姿勢"
                ],
                conclusion: "→ **「内なる強さと信念で世界に影響を与えた」**点があなたの魂に共鳴しています！"
              }
            ],
            resultId: Date.now().toString()
          }),
        };
      }
    }
  } catch (error) {
    console.error("エラー:", error);

    // エラー応答
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "診断処理中にエラーが発生しました",
        message: error.message,
        fallback: true,
        destiny: "申し訳ありませんが、現在システムが混雑しております。しばらく時間をおいて再度お試しください。",
        reincarnations: []
      }),
    };
  }
};