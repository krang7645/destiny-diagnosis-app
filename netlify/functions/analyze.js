const { Configuration, OpenAIApi } = require("openai");
const axios = require("axios");

// 結果を一時的に保存するためのMap
const resultStore = new Map();

// リトライ設定
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1秒
const TIMEOUT = 10000; // 10秒

// OpenAI API呼び出しの関数
async function callOpenAIWithRetry(openai, messages, retryCount = 0) {
  try {
    const response = await Promise.race([
      openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('APIリクエストがタイムアウトしました')), TIMEOUT)
      )
    ]);

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(`API call attempt ${retryCount + 1} failed:`, error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
    }

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return callOpenAIWithRetry(openai, messages, retryCount + 1);
    }
    throw error;
  }
}

exports.handler = async function(event, context) {
  console.log("Function started - Request received");

  // CORSヘッダーの設定
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json"
  };

  // OPTIONSリクエスト対応
  if (event.httpMethod === "OPTIONS") {
    console.log("OPTIONS request handled");
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Successful preflight call" }),
    };
  }

  // GETリクエストの場合、結果を取得
  if (event.httpMethod === "GET") {
    const resultId = event.queryStringParameters?.resultId;
    if (!resultId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "結果IDが指定されていません" }),
      };
    }

    const result = resultStore.get(resultId);
    if (!result) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "指定された結果が見つかりません" }),
      };
    }

    if (result.status === "processing") {
      return {
        statusCode: 202,
        headers,
        body: JSON.stringify({ status: "processing" }),
      };
    }

    // 結果が完了している場合、結果を返して保存データを削除
    resultStore.delete(resultId);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  }

  // POSTリクエスト以外は拒否
  if (event.httpMethod !== "POST") {
    console.log(`Invalid HTTP method: ${event.httpMethod}`);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    console.log("Parsing request body");
    const data = JSON.parse(event.body);
    const { name, birthdate, mbti, stage } = data;
    console.log(`Received data - Name: ${name}, Birthdate: ${birthdate}, MBTI: ${mbti}, Stage: ${stage}`);

    if (!name || !birthdate || !mbti) {
      console.log("Validation failed - Missing required parameters");
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "必須パラメータが不足しています" }),
      };
    }

    console.log("Configuring OpenAI API");
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!process.env.OPENAI_API_KEY) {
      console.log("OpenAI API key not found");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "OpenAI APIキーが設定されていません" }),
      };
    }

    const openai = new OpenAIApi(configuration);
    console.log("OpenAI API configured successfully");

    let prompt = '';
    if (stage === 'destiny' || !stage) {
      console.log("Generating destiny prompt");
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
      console.log("Generating pastlife prompt");
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

    console.log("Starting OpenAI API call with retry mechanism");
    const messages = [
      { role: "system", content: "あなたは占い師です。依頼者の運命を詳細に診断します。" },
      { role: "user", content: prompt }
    ];

    try {
      const content = await callOpenAIWithRetry(openai, messages);
      console.log("OpenAI API call completed successfully");

      if (stage === 'destiny' || !stage) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            stage: 'destiny',
            result: content
          }),
        };
      } else if (stage === 'pastlife') {
        const result = extractReincarnations(content);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            stage: 'pastlife',
            ...result
          }),
        };
      }
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      let errorMessage = error.message;
      if (error.response && error.response.data && error.response.data.error) {
        errorMessage = `${error.message} - ${error.response.data.error.message || '詳細不明'}`;
      }
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "OpenAI APIの呼び出し中にエラーが発生しました",
          message: errorMessage
        }),
      };
    }

  } catch (error) {
    console.error("Unexpected error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "予期せぬエラーが発生しました",
        message: error.message
      }),
    };
  }
};

// 前世データから人物情報を抽出する関数
function extractReincarnations(content) {
  // 全体のテキストを取得
  const fullText = content.trim();

  // 候補を抽出
  const sections = fullText.split(/\d+\.\s*-?\s*/).filter(Boolean);

  const reincarnations = [];

  // 各セクションから情報を抽出
  for (let i = 0; i < sections.length && i < 3; i++) {
    const section = sections[i];

    // 名前と年代を抽出
    const nameMatch = section.match(/名前と生没年[:：]?\s*([^（\n]+)（([^）]+)）/);
    if (!nameMatch) continue;

    const name = nameMatch[1]?.trim();
    const years = nameMatch[2]?.trim();

    // 理由を抽出
    const reasons = [];
    const reasonSection = section.split(/理由[:：]/)[1];
    if (reasonSection) {
      const reasonLines = reasonSection.split('\n')
        .map(line => line.trim())
        .filter(line => line && line !== '理由:' && !line.startsWith('結論'));

      // 箇条書きの記号を削除して理由を追加
      for (const line of reasonLines) {
        const cleanedLine = line.replace(/^[•\-\*→]/, '').trim();
        if (cleanedLine && !cleanedLine.includes('生まれ変わり説アリ')) {
          reasons.push(cleanedLine);
        }
      }
    }

    // 結論を抽出
    let conclusion = '';
    const conclusionMatch = section.match(/(?:▶︎\s*生まれ変わり説アリ|結論[:：])\s*\n*→?\s*([^\n]+)/);
    if (conclusionMatch) {
      conclusion = conclusionMatch[1].trim();
    }

    if (name && years) {
      reincarnations.push({
        name,
        years,
        reasons: reasons.length > 0 ? reasons : ['前世の特徴を分析中です'],
        conclusion: conclusion || '結論を分析中です'
      });
    }
  }

  // 最終的な結論を抽出
  let finalConclusion = '';
  const finalConclusionMatch = content.match(/(?:結論：|総合的な結論：)[\s\S]*?\n\n([\s\S]+)$/);
  if (finalConclusionMatch) {
    finalConclusion = finalConclusionMatch[1].trim();
  }

  // 3人に満たない場合は補完
  while (reincarnations.length < 3) {
    reincarnations.push({
      name: `分析中の歴史上の人物${reincarnations.length + 1}`,
      years: "生没年を特定中",
      reasons: ["前世の特徴を分析中です"],
      conclusion: "結論を導き出しています"
    });
  }

  return {
    reincarnations,
    finalConclusion: finalConclusion || '総合的な結論を分析中です'
  };
}