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

    try {
      // OpenAI API呼び出し (v3系の構文)
      const response = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "あなたは運命診断の専門家です。回答は必ず指定されたJSON形式で簡潔に返してください。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 800
      });

      // 応答テキストを取得
      const content = response.data.choices[0].message.content;

      // JSONを解析
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
        console.error("JSONパースエラー:", jsonError);

        // JSONパースエラー時はテキストからJSONを抽出
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
          throw new Error("APIレスポンスからJSONを見つけられませんでした");
        }
      }
    } catch (apiError) {
      console.error("API呼び出しエラー:", apiError);

      // バックアップロジック - MBTIタイプに基づいた代替レスポンスを生成
      const mbtiTraits = {
        'INTJ': '論理的思考と長期的なビジョンで世界を変革する',
        'INTP': '知的探求と理論の構築によって新たな知見をもたらす',
        'ENTJ': 'リーダーシップと戦略的思考で組織や社会を導く',
        'ENTP': '革新的なアイデアと議論によって既存の枠組みを壊す',
        'INFJ': '深い洞察力と誠実さで人々の心に触れ、社会に貢献する',
        'INFP': '理想と創造性によって世界に美と調和をもたらす',
        'ENFJ': '人々の成長を促し、コミュニティの絆を強める',
        'ENFP': '情熱と創造性で人々を鼓舞し、可能性を広げる',
        'ISTJ': '秩序と責任感によって社会の安定を支える',
        'ISFJ': '思いやりと献身によって周囲の人々を支え守る',
        'ESTJ': '効率性と実行力で組織を導き、目標を達成する',
        'ESFJ': '調和と協力を促進し、コミュニティの結束を高める',
        'ISTP': '実践的な問題解決と適応力で状況を打開する',
        'ISFP': '感性と自由な表現によって人々の心に美を届ける',
        'ESTP': '行動力と機転で困難を乗り越え、人生を楽しむ',
        'ESFP': '活力と魅力で周囲を明るくし、人々に喜びをもたらす'
      };

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
      } else {
        zodiac = '不明な星座';
      }

      // 字画の簡易計算
      const strokeCount = name.length * 7 + 2;

      // 汎用的な歴史上の人物リスト
      const genericFigures = [
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

      // 天命の生成
      const destiny = `${name}さんは${zodiac}の影響を受け、${strokeCount}画の名前が示す「${strokeCount % 10 === 0 ? '完全なる調和' : '創造的なエネルギー'}」を持っています。${mbtiTraits[mbti] || '多様な才能と可能性'}という特性と組み合わさり、あなたの天命は「${mbti[0] === 'E' ? '人々を導き' : '深く考察し'}、${mbti[1] === 'N' ? '新たな可能性を見出し' : '現実的な解決策を提供し'}、${mbti[2] === 'F' ? '人々の心に寄り添いながら' : '論理的な判断に基づいて'}、${mbti[3] === 'P' ? '柔軟に状況に適応していく' : '確実に目標を達成していく'}」ことにあります。`;

      // API呼び出し失敗時のバックアップレスポンス
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          destiny: destiny,
          reincarnations: genericFigures,
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