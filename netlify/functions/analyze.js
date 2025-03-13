const { Configuration, OpenAIApi } = require("openai");
const axios = require("axios");

// 結果を一時的に保存するためのMap
const resultStore = new Map();

// リトライ設定
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000; // 3秒
const TIMEOUT = 120000; // 120秒に延長

// OpenAI API呼び出しの関数
async function callOpenAIWithRetry(openai, messages, retryCount = 0) {
  try {
    console.log(`API call attempt ${retryCount + 1} started with ${TIMEOUT/1000}s timeout`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log('Request timeout, aborting...');
    }, TIMEOUT);

    try {
      const response = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      }, { signal: controller.signal });

      clearTimeout(timeoutId);
      console.log(`API call attempt ${retryCount + 1} completed successfully`);
      return response.data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    console.error(`API call attempt ${retryCount + 1} failed:`, error.message);
    if (error.response) {
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
      console.error('Error response status:', error.response.status);
    }

    // レート制限エラーの特別処理
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 60;
      console.log(`Rate limit exceeded. Waiting for ${retryAfter} seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return callOpenAIWithRetry(openai, messages, retryCount);
    }

    // タイムアウトエラーまたはその他のエラーの場合、リトライを試みる
    if (retryCount < MAX_RETRIES) {
      const nextRetryDelay = RETRY_DELAY * Math.pow(2, retryCount); // 指数バックオフを強化
      console.log(`Retrying in ${nextRetryDelay}ms... (Attempt ${retryCount + 2}/${MAX_RETRIES + 1})`);
      await new Promise(resolve => setTimeout(resolve, nextRetryDelay));
      return callOpenAIWithRetry(openai, messages, retryCount + 1);
    }

    // 最大リトライ回数を超えた場合
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      throw new Error("APIリクエストがタイムアウトしました。しばらく時間をおいてから再度お試しください。");
    } else if (error.response?.status === 429) {
      throw new Error("APIのレート制限に達しました。しばらく時間をおいてから再度お試しください。");
    } else {
      console.error('Maximum retry attempts reached');
      throw new Error(`APIリクエストが${MAX_RETRIES + 1}回失敗しました: ${error.message}`);
    }
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
    } else if (stage === 'pastlife1') {
      console.log("Generating first pastlife prompt");
      const destinyData = data.destinyData || '';
      prompt = `
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

天命の診断結果:
${destinyData}

上記の天命分析に基づいて、この人物の「前世」として最も可能性の高い歴史上の指導者や政治家を1名診断してください。
以下のフォーマットで詳しく解説してください：

候補1：[職業・役割]・[人物名]（[生没年]）

『[有名な言葉や名言]』

→ [その人物が何をした人か、最も重要な業績や特徴]
→ [その人物の生き方や哲学]
→ [${name}さんとの共通点]

▶︎ 生まれ変わり説アリ
→ もし魂が現代に転生していたら、[現代での活躍予想]

結論：[この人物が前世である理由と現代への示唆]

回答は必ず上記のフォーマットに従い、矢印（→）を使って特徴を示してください。
`;
    } else if (stage === 'pastlife2') {
      console.log("Generating second pastlife prompt");
      const destinyData = data.destinyData || '';
      prompt = `
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

天命の診断結果:
${destinyData}

上記の天命分析に基づいて、この人物の「前世」として最も可能性の高い歴史上の芸術家や文化人を1名診断してください。
以下のフォーマットで詳しく解説してください：

候補1：[職業・役割]・[人物名]（[生没年]）

『[有名な言葉や名言]』

→ [その人物が何をした人か、最も重要な業績や特徴]
→ [その人物の生き方や哲学]
→ [${name}さんとの共通点]

▶︎ 生まれ変わり説アリ
→ もし魂が現代に転生していたら、[現代での活躍予想]

結論：[この人物が前世である理由と現代への示唆]

回答は必ず上記のフォーマットに従い、矢印（→）を使って特徴を示してください。
`;
    } else if (stage === 'pastlife3') {
      console.log("Generating third pastlife prompt");
      const destinyData = data.destinyData || '';
      prompt = `
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

天命の診断結果:
${destinyData}

上記の天命分析に基づいて、この人物の「前世」として最も可能性の高い歴史上の科学者や発明家を1名診断してください。
以下のフォーマットで詳しく解説してください：

候補1：[職業・役割]・[人物名]（[生没年]）

『[有名な言葉や名言]』

→ [その人物が何をした人か、最も重要な業績や特徴]
→ [その人物の生き方や哲学]
→ [${name}さんとの共通点]

▶︎ 生まれ変わり説アリ
→ もし魂が現代に転生していたら、[現代での活躍予想]

結論：[この人物が前世である理由と現代への示唆]

回答は必ず上記のフォーマットに従い、矢印（→）を使って特徴を示してください。
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
      } else if (stage === 'pastlife1' || stage === 'pastlife2' || stage === 'pastlife3') {
        const result = extractReincarnations(content);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            stage: stage,
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
  try {
    console.log('Starting data extraction...');
    const fullText = content.trim();
    console.log('Raw content length:', fullText.length);
    console.log('Raw content preview:', fullText.substring(0, 200));

    // より柔軟なセクション分割
    let section = '';
    if (fullText.includes('候補1：')) {
      section = fullText.split('候補1：')[1]?.trim() || '';
    } else {
      // 候補1：がない場合は全体を処理
      section = fullText;
    }
    console.log('Section length:', section.length);
    console.log('Section preview:', section.substring(0, 200));

    if (!section) {
      console.log('No valid section found');
      return {
        status: 'processing',
        message: '前世の解析を続けています...',
        debug: { rawContent: fullText }
      };
    }

    // データ抽出の改善
    const extractData = () => {
      // 名前と年代の抽出（より柔軟なパターン）
      let name = null;
      let years = null;
      const nameYearMatch = section.match(/([^（\n]*[^（\s]*)[\s]*[（(]([^）)]+)[）)]/);
      if (nameYearMatch) {
        name = nameYearMatch[1]?.trim();
        years = nameYearMatch[2]?.trim();
      }
      console.log('Extracted name:', name);
      console.log('Extracted years:', years);

      // 名言の抽出（複数のパターンに対応）
      let quote = null;
      const quotePatterns = [/『([^』]+)』/, /「([^」]+)」/, /"([^"]+)"/];
      for (const pattern of quotePatterns) {
        const match = section.match(pattern);
        if (match) {
          quote = match[1].trim();
          break;
        }
      }
      console.log('Extracted quote:', quote);

      // 理由の抽出（改善版）
      const reasons = section
        .split(/\n/)
        .filter(line => line.trim().startsWith('→'))
        .map(line => line.trim().replace(/^→\s*/, ''));
      console.log('Extracted reasons:', reasons);

      // 結論の抽出（より柔軟なパターン）
      let conclusion = '';
      const conclusionPatterns = [
        /生まれ変わり説アリ[^→]*→\s*([^\n]+)/,
        /現代での活躍予想[：:]\s*([^\n]+)/,
        /現代に転生していたら[^→]*→\s*([^\n]+)/
      ];
      for (const pattern of conclusionPatterns) {
        const match = section.match(pattern);
        if (match) {
          conclusion = match[1].trim();
          break;
        }
      }
      console.log('Extracted conclusion:', conclusion);

      // 最終結論の抽出（より柔軟なパターン）
      let finalConclusion = '';
      const finalConclusionPatterns = [
        /結論：([^]*?)(?=$|\n\n)/,
        /総括：([^]*?)(?=$|\n\n)/,
        /まとめ：([^]*?)(?=$|\n\n)/
      ];
      for (const pattern of finalConclusionPatterns) {
        const match = section.match(pattern);
        if (match) {
          finalConclusion = match[1].trim();
          break;
        }
      }
      console.log('Extracted finalConclusion:', finalConclusion);

      return { name, years, quote, reasons, conclusion, finalConclusion };
    };

    const extractedData = extractData();
    console.log('Full extracted data:', extractedData);

    // データの検証
    const validation = {
      hasName: !!extractedData.name,
      hasYears: !!extractedData.years,
      hasQuote: !!extractedData.quote,
      reasonCount: extractedData.reasons.length,
      hasConclusion: !!extractedData.conclusion,
      hasFinalConclusion: !!extractedData.finalConclusion
    };
    console.log('Validation results:', validation);

    // 必要最小限のデータが揃っているか確認
    if (!extractedData.name || !extractedData.years) {
      return {
        status: 'processing',
        message: '前世の解析を続けています...',
        debug: { validation, section: section.substring(0, 200) }
      };
    }

    // 結果の整形
    const result = {
      reincarnations: [{
        name: extractedData.name,
        years: extractedData.years,
        quote: extractedData.quote || null,
        reasons: extractedData.reasons.length > 0 ? extractedData.reasons : ['解析中...'],
        conclusion: extractedData.conclusion || '解析中...'
      }],
      finalConclusion: extractedData.finalConclusion || '解析中...',
      status: 'complete'
    };

    console.log('Final result:', JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error('Error in extractReincarnations:', error);
    return {
      status: 'processing',
      message: '前世の解析中にエラーが発生しました。再試行しています...',
      error: error.message,
      debug: { content: content.substring(0, 200) }
    };
  }
}