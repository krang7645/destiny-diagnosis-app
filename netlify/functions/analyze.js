const { Configuration, OpenAIApi } = require("openai");

exports.handler = async function(event, context) {
  // CORSヘッダーの設定
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    const { name, birthdate, mbti, stage } = data;

    // バリデーション
    if (!name || !birthdate || !mbti) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "必須パラメータが不足しています" }),
      };
    }

    // OpenAI API設定
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "OpenAI APIキーが設定されていません" }),
      };
    }

    const openai = new OpenAIApi(configuration);

    // ステージに応じたプロンプト生成
    let prompt = '';
    if (stage === 'destiny' || !stage) {
      // 第一段階: 天命診断
      prompt = `
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

あなたは占い師として、上記の人物の「天命」を診断してください。以下の6つの側面から分析し、最後に総合的な天命を示してください。

1. 星座分析: 生年月日から星座を特定し、その特徴と向いている職業を説明
2. MBTI分析: MBTIタイプの特徴を箇条書きで3つ示し、向いている仕事を提案
3. 数秘術: 生年月日から数秘術で運命数を計算し、その意味を説明
4. 姓名判断（画数分析）: 姓と名の画数、その意味、総合的な解釈
5. 音の響き分析: 名前の音の持つエネルギーと特性
6. 漢字の意味分析: 名前の漢字が象徴する意味

最後に「天命」として3つの特徴と結論を箇条書きで示してください。

小松竜之介（1990年07月31日、ESFP）の例に似た詳細さとフォーマットで回答してください。
`;
    } else if (stage === 'pastlife') {
      // 第二段階: 前世診断（天命データを含める）
      const destinyData = data.destinyData || '';
      prompt = `
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

天命の診断結果:
${destinyData}

上記の天命分析に基づいて、この人物の「前世」として考えられる歴史上の人物を3名診断してください。

各人物について:
1. 名前と生没年
2. 前世である理由（太字付きの箇条書きで4点）
3. 結論（→ で始まる一文）

最後に、3人の共通点から総合的な前世の可能性について簡潔にまとめてください。

チャールズ・チャップリン、宮本武蔵、ピーター大帝の例のような詳細さとフォーマットで回答してください。
`;
    }

    // OpenAI API呼び出しを非同期で行う
    const getOpenAIResponse = async () => {
      const response = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "あなたは占い師です。依頼者の運命を詳細に診断します。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });
      return response.data.choices[0].message.content;
    };

    // 非同期処理の開始
    getOpenAIResponse().then(content => {
      // 結果ID
      const resultId = Date.now().toString();

      // ステージに応じた結果を返す
      if (stage === 'destiny' || !stage) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            stage: 'destiny',
            result: content,
            resultId
          }),
        };
      } else if (stage === 'pastlife') {
        // 前世データを解析して構造化
        const reincarnations = extractReincarnations(content);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            stage: 'pastlife',
            reincarnations,
            resultId
          }),
        };
      }
    }).catch(error => {
      console.error("エラー:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "診断処理中にエラーが発生しました",
          message: error.message
        }),
      };
    });

    // 処理中のメッセージを即座に返す
    return {
      statusCode: 202,
      headers,
      body: JSON.stringify({
        message: "診断を処理中です。結果が準備でき次第、通知されます。"
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

// 前世データから人物情報を抽出する関数
function extractReincarnations(content) {
  const reincarnations = [];

  // 人物ごとのパターンを検索（改行を含む）
  const personRegex = /\d+\.\s+(.*?)（(.*?)）[\s\S]*?(?=\d+\.|\s*$)/g;
  const matches = content.matchAll(personRegex);

  for (const match of Array.from(matches)) {
    // 人物のテキスト全体
    const personText = match[0];

    // 名前と年
    const name = match[1]?.trim() || '不明';
    const years = match[2]?.trim() || '不明';

    // 理由を抽出
    const reasonsRegex = /[•\*\-]\s+(.*?)(?=\n[•\*\-]|\n→|\s*$)/g;
    const reasonsMatches = personText.matchAll(reasonsRegex);
    const reasons = Array.from(reasonsMatches).map(m => m[1]?.trim() || '').filter(r => r);

    // 結論を抽出
    const conclusionMatch = personText.match(/→\s+(.*?)(?=\s*$|\n)/);
    const conclusion = conclusionMatch ? conclusionMatch[1]?.trim() : '';

    reincarnations.push({
      name,
      years,
      reasons: reasons.length > 0 ? reasons : ['理由の詳細が不明です'],
      conclusion: conclusion || '結論が見つかりませんでした'
    });
  }

  // 3人に満たない場合は補完
  while (reincarnations.length < 3) {
    reincarnations.push({
      name: `歴史上の人物${reincarnations.length + 1}`,
      years: "生没年不詳",
      reasons: [
        "**特性1**：詳細が十分に解析できませんでした",
        "**特性2**：詳細が十分に解析できませんでした",
        "**特性3**：詳細が十分に解析できませんでした",
        "**特性4**：詳細が十分に解析できませんでした"
      ],
      conclusion: "→ **「結論」**はデータ不足のため提供できません"
    });
  }

  return reincarnations.slice(0, 3);
}