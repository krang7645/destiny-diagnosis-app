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
        max_tokens: 2000
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
以下のフォーマットで、各候補者について詳しく解説してください。
必ず3名の候補者を挙げてください。2名や1名では不十分です：

候補1：[職業・役割]・[人物名]（[生没年]）

『[有名な言葉や名言]』

→ [その人物が何をした人か、最も重要な業績や特徴]
→ [その人物の生き方や哲学]
→ [${name}さんとの共通点]

▶︎ 生まれ変わり説アリ
→ もし魂が現代に転生していたら、[現代での活躍予想]

⸻

候補2：[以下同様のフォーマット]

⸻

候補3：[以下同様のフォーマット]

このように、各候補者について：
1. 職業や役割を含めた完全な名前と生没年
2. その人物の有名な言葉や名言（ある場合）
3. 3つの特徴（→ で始まる）
4. 現代に転生した場合の予想

最後に、3人の共通点から総合的な結論を示してください。
結論は「結論：」で始まり、改行を入れて詳しく説明してください。

回答は必ず上記のフォーマットに従い、各セクションを⸻（ダッシュ3つ）で区切ってください。
必ず3名の候補者を挙げ、それぞれの情報を詳しく記載してください。
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

// 前世データから人物情報を抽出する関数を修正
function extractReincarnations(content) {
  // 全体のテキストを取得
  const fullText = content.trim();

  // 候補を抽出（「候補X：」で分割）
  const sections = fullText.split(/(?=候補[1-3]：)/).filter(Boolean);

  const reincarnations = [];
  const expectedCandidates = 3;

  // 各セクションから情報を抽出
  for (let i = 0; i < sections.length && i < expectedCandidates; i++) {
    const section = sections[i];
    console.log(`Processing section ${i + 1}:`, section.substring(0, 100)); // デバッグ用ログ

    // 名前と年代を抽出
    const nameMatch = section.match(/[^：\n]*：([^（\n]+)（([^）]+)）/);
    const name = nameMatch ? nameMatch[1]?.trim() : `分析中の歴史上の人物${i + 1}`;
    const years = nameMatch ? nameMatch[2]?.trim() : "生没年を分析中";

    // 名言を抽出
    let quote = '';
    const quoteMatch = section.match(/『([^』]+)』/);
    if (quoteMatch) {
      quote = quoteMatch[1].trim();
    }

    // 特徴（理由）を抽出
    const reasons = [];
    const reasonsSection = section.split('▶︎')[0];
    const lines = reasonsSection.split('\n');
    let currentReasons = [];
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('→')) {
        const reason = trimmedLine.substring(1).trim();
        if (reason) currentReasons.push(reason);
      } else if (!trimmedLine.includes('候補') && !trimmedLine.includes('：') &&
                 !trimmedLine.includes('『') && !trimmedLine.includes('』') &&
                 trimmedLine.length > 10) {
        currentReasons.push(trimmedLine);
      }
    }

    // 長い文章を3つの理由に分割
    let processedReasons = [];
    if (currentReasons.length > 0) {
      const fullText = currentReasons.join(' ').replace(/。/g, '。\n').split('\n').filter(Boolean);

      // テキストを3つのパートに分割
      if (fullText.length >= 3) {
        processedReasons = fullText.slice(0, 3);
      } else if (fullText.length === 2) {
        processedReasons = [...fullText, '更なる特徴を分析中です'];
      } else if (fullText.length === 1) {
        const parts = fullText[0].split('。').filter(Boolean);
        if (parts.length >= 3) {
          processedReasons = parts.slice(0, 3).map(p => p + '。');
        } else {
          processedReasons = [...parts.map(p => p + '。'), ...Array(3 - parts.length).fill('特徴を分析中です')];
        }
      }
    }

    reasons.push(...(processedReasons.length > 0 ? processedReasons : [
      'この歴史上の人物の業績を分析しています',
      'その人物の特徴や哲学を分析しています',
      `${name}さんとの共通点を分析しています`
    ]));

    // 結論を抽出
    let conclusion = '';
    const conclusionMatch = section.match(/▶︎[^→]*→\s*([^\n]+)/);
    if (conclusionMatch) {
      conclusion = conclusionMatch[1].trim();
    } else {
      const conclusionSection = section.split('▶︎')[1];
      if (conclusionSection) {
        const lines = conclusionSection.split('\n');
        for (const line of lines) {
          if (line.trim() && !line.includes('⸻')) {
            conclusion = line.trim().replace(/^→\s*/, '');
            break;
          }
        }
      }
    }

    // 候補者情報を追加
    reincarnations.push({
      name,
      years,
      quote: quote || "名言を分析中",
      reasons: reasons.slice(0, 3),  // 必ず3つの理由に制限
      conclusion: conclusion || '現代での活躍の可能性を分析しています'
    });
  }

  // 3人に満たない場合は補完
  while (reincarnations.length < expectedCandidates) {
    const index = reincarnations.length + 1;
    reincarnations.push({
      name: `分析中の歴史上の人物${index}`,
      years: "生没年を分析中",
      quote: "名言を分析中",
      reasons: ["この歴史上の人物の特徴を分析しています"],
      conclusion: "現代での活躍の可能性を分析しています"
    });
  }

  // デバッグ用ログ
  console.log('Extracted reincarnations:', JSON.stringify(reincarnations, null, 2));

  // 最終的な結論を抽出
  let finalConclusion = '';
  const finalConclusionMatch = content.match(/結論：\s*\n+([\s\S]+?)(?:\n\s*$|$)/);
  if (finalConclusionMatch) {
    finalConclusion = finalConclusionMatch[1].trim();
  }

  return {
    reincarnations,
    finalConclusion: finalConclusion || '総合的な結論を分析中です'
  };
}