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

    // プロンプトを簡素化して応答速度を上げる
    const prompt = `
あなたは占いの専門家です。依頼者の情報をもとに、その人の「天命」と「前世」を詳細に診断してください。
回答は以下のフォーマットを厳密に守って生成してください。

【依頼者情報】
名前: ${name}
生年月日: ${birthdate}
MBTI: ${mbti}

【診断内容】
まず、依頼者の概要から始め、親しみやすい語り口で話しかけるように書いてください：
「${name}さん（${birthdate}生まれ・${mbti}）の天命を占うには、**生年月日・MBTI・星座・数秘術**などの視点から総合的に見ていくのが面白いね。」

次に、以下の4セクションで構成する詳細な分析を提供してください：

1. 星座分析：
  - 生年月日から星座を特定
  - その星座の特徴と向いている仕事

2. MBTI分析：
  - MBTIタイプの基本的特徴を箇条書きで3つ程度
  - その性格から導き出される向いている仕事

3. 数秘術：
  - 生年月日を数秘術で計算（各桁の数字を足して1桁になるまで計算）
  - その数字の意味と使命

4. 姓名判断：
  - 姓と名の画数およびその意味
  - 名前の音の響きの分析
  - 漢字の意味と象徴性

最後に、これらの分析を統合して「天命」をまとめ、その天命に基づいて前世と考えられる歴史上の人物を3人挙げてください。各人物について：
  - 名前と生没年
  - その人物が前世である理由を箇条書きで4点
  - 結論（→ で始まる一文）

すべての回答は親しみやすく、興味を引く口調で、詳細かつ具体的に書いてください。
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
      const destiny = content.split(/前世|歴史上の人物/)[0].trim();

      // 前世の部分を抽出
      const reincarnationText = content.split(/前世|歴史上の人物/)[1] || "";

      // 正規表現で3人の人物を抽出
      const personMatches = reincarnationText.match(/\d+\.\s+(.*?)（(.*?)）[\s\S]*?→\s+(.*?)(?=\s*\d+\.\s+|$)/g);

      const reincarnations = [];

      if (personMatches) {
        personMatches.forEach(match => {
          const nameMatch = match.match(/\d+\.\s+(.*?)（(.*?)）/);
          const reasonsMatch = match.match(/•\s+(.*?)(?=•|\n|→)/g);
          const conclusionMatch = match.match(/→\s+(.*?)$/);

          if (nameMatch) {
            const name = nameMatch[1];
            const years = nameMatch[2];

            const reasons = reasonsMatch ?
              reasonsMatch.map(r => r.replace(/^•\s+/, '').trim()) :
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

      // 3人に満たない場合はダミーデータを追加
      while (reincarnations.length < 3) {
        reincarnations.push({
          name: `歴史上の人物${reincarnations.length + 1}`,
          years: "不明",
          reasons: [
            "**特徴1**：詳細な説明",
            "**特徴2**：詳細な説明",
            "**特徴3**：詳細な説明",
            "**特徴4**：詳細な説明"
          ],
          conclusion: "→ **「キーポイント」**の点で共通点があります！"
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

      // API呼び出し失敗時のバックアップ応答
      // 星座の計算
      const birthParts = birthdate.match(/(\d{4})年(\d{2})月(\d{2})日/);
      let zodiac = '';
      if (birthParts) {
        const month = parseInt(birthParts[2]);
        const day = parseInt(birthParts[3]);

        if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) zodiac = '牡羊座';
        else if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) zodiac = '牡牛座';
        else if ((month === 5 && day >= 21) || (month === 6 && day <= 21)) zodiac = '双子座';
        else if ((month === 6 && day >= 22) || (month === 7 && day <= 22)) zodiac = '蟹座';
        else if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) zodiac = '獅子座';
        else if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) zodiac = '乙女座';
        else if ((month === 9 && day >= 23) || (month === 10 && day <= 23)) zodiac = '天秤座';
        else if ((month === 10 && day >= 24) || (month === 11 && day <= 22)) zodiac = '蠍座';
        else if ((month === 11 && day >= 23) || (month === 12 && day <= 21)) zodiac = '射手座';
        else if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) zodiac = '山羊座';
        else if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) zodiac = '水瓶座';
        else zodiac = '魚座';
      }

      // バックアップ用のサンプル診断
      const sampleDestiny = `${name}さん（${birthdate}生まれ・${mbti}）の天命を占うには、**生年月日・MBTI・星座・数秘術**などの視点から総合的に見ていくのが面白いね。

**1. 星座：${zodiac}**

${zodiac}は「個性」と「直感力」の星。生まれつき創造的な発想があり、人との繋がりを大切にする傾向があります。表現力が豊かで、芸術やコミュニケーションの分野で才能を発揮することが多いでしょう。

**2. MBTI：${mbti}**

${mbti}の特徴：
✔ 洞察力に優れ、物事の本質を見抜く力がある
✔ 創造的な問題解決能力を持ち、新しいアイディアを生み出す
✔ 人間関係において誠実さを大切にする

この性格だと「創造的な仕事」や「人の役に立つ仕事」が向いています。アーティスト、教育者、カウンセラー、研究者など、深い思考と創造性が求められる分野で才能を発揮するでしょう。

**3. 数秘術（${birthdate.replace(/[年月日]/g, '')} → 計算結果）**

数秘術で導かれるのは「7」= **分析と探求の数字**。
✔ 深い洞察力と分析力を持つ
✔ 精神的な成長と真理の探求が人生のテーマ
✔ 独自の視点で物事を見る才能がある

**4. 姓名判断**

**${name}**の画数分析：
• 総画数：27画
• 天格：8画（リーダーシップの数）
• 人格：15画（創造性の数）
• 地格：12画（協調性の数）

**画数の意味**
✅ 27画（総画数）：独創的、革新的、強い意志力
✅ 漢字の意味：「知恵」と「力強さ」の象徴

**→ 結論：「創造性と分析力を活かして、新しい道を切り拓く才能がある」**

あなたの天命は「**深い洞察力と創造性を活かし、周囲の人々に新しい視点をもたらす**」ことにあります。既存の枠組みにとらわれず、独自の道を切り拓くことで成功するでしょう。`;

      const sampleReincarnations = [
        {
          name: "レオナルド・ダ・ヴィンチ",
          years: "1452-1519",
          reasons: [
            "**多才な創造性**：芸術から科学まで幅広い分野で才能を発揮",
            "**先進的な思考**：時代を数百年先取りした発明と考察",
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
      ];

      // API呼び出し失敗時のバックアップレスポンス
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          destiny: sampleDestiny,
          reincarnations: sampleReincarnations,
          resultId: Date.now().toString(),
          fallback: true // これがバックアップ応答であることを示すフラグ
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
        message: error.message,
        fallback: true,
        destiny: "申し訳ありませんが、処理中にエラーが発生しました。入力内容を確認して再度お試しください。",
        reincarnations: []
      }),
    };
  }
};