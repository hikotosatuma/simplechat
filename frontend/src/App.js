// frontend/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import axios from 'axios';
import './App.css';

// 設定を読み込む関数
const loadConfig = () => {
  // ウィンドウオブジェクトから設定を取得
  if (window.REACT_APP_CONFIG) {
    return {
      apiEndpoint: window.REACT_APP_CONFIG.apiEndpoint,
      userPoolId: window.REACT_APP_CONFIG.userPoolId,
      userPoolClientId: window.REACT_APP_CONFIG.userPoolClientId,
      region: window.REACT_APP_CONFIG.region,
    };
  }
  
  // 環境変数から設定を取得（ローカル開発用）
  return {
    apiEndpoint: process.env.REACT_APP_API_ENDPOINT || 'YOUR_API_ENDPOINT',
    userPoolId: process.env.REACT_APP_USER_POOL_ID || 'YOUR_USER_POOL_ID',
    userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || 'YOUR_USER_POOL_CLIENT_ID',
    region: process.env.REACT_APP_REGION || 'us-east-1',
  };
};

// 設定を取得
const config = loadConfig();

// Amplify設定
Amplify.configure({
  Auth: {
    region: config.region,
    userPoolId: config.userPoolId,
    userPoolWebClientId: config.userPoolClientId,
  },
});

// ChatInterfaceコンポーネントの定義
function ChatInterface({ signOut, user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [difficulty, setDifficulty] = useState('中');
  const [generatedQA, setGeneratedQA] = useState('');
  const [isGeneratingQA, setIsGeneratingQA] = useState(false);
  const [showQAModal, setShowQAModal] = useState(false);
  const [currentQuestions, setCurrentQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isInQuizMode, setIsInQuizMode] = useState(false);
  const [userAnswers, setUserAnswers] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [questionRatings, setQuestionRatings] = useState({}); // 問題の評価を管理
  const messagesEndRef = useRef(null);



  // メッセージが追加されたら自動スクロール
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // メッセージが変更されたら現在のチャットを自動保存
  useEffect(() => {
    if (messages.length > 0 && currentChatId) {
      saveChatToHistory();
    }
  }, [messages, uploadedFiles]);

  // 初回読み込み時に新しいチャットIDを設定
  useEffect(() => {
    if (!currentChatId) {
      setCurrentChatId(Date.now());
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ファイルアップロード処理
  const handleFileUpload = async (file) => {
    if (!file) return;

    // サポートされているファイル形式をチェック
    const supportedTypes = ['application/pdf', 
                           'application/vnd.ms-powerpoint',  // PPT（古い形式）
                           'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
                           'application/msword', // DOC（古い形式）
                           'text/plain']; // TXT
    
    const supportedExtensions = ['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.txt'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (!supportedTypes.includes(file.type) && !supportedExtensions.includes(fileExtension)) {
      setError('サポートされていないファイル形式です。PDF、PPT、PPTX、DOC、DOCX、TXTファイルをアップロードしてください。');
      return;
    }

    setError(null);

    try {
      // 認証トークンを取得
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      // ファイルをBase64に変換
      const fileReader = new FileReader();
      fileReader.onload = async (e) => {
        try {
          const base64Data = e.target.result.split(',')[1]; // Base64データ部分のみ取得

          const uploadResponse = await axios.post(config.apiEndpoint.replace('/chat', '/upload'), {
            file: base64Data,
            fileName: file.name,
            fileType: file.type
          }, {
            headers: {
              'Authorization': idToken,
              'Content-Type': 'application/json'
            }
          });

          if (uploadResponse.data.success) {
            const newFile = {
              name: file.name,
              extractedText: uploadResponse.data.extracted_text,
              fileKey: uploadResponse.data.file_key
            };
            
            setUploadedFiles(prev => [...prev, newFile]);
            
            // シンプルなアップロード完了メッセージ
            setMessages(prev => [...prev, 
              { role: 'system', content: `✅ ファイル "${file.name}" がアップロードされ、テキスト抽出が完了しました。チャットでファイルの内容について質問できます。` }
            ]);
          } else {
            setError('ファイルのアップロードに失敗しました');
          }
        } catch (err) {
          console.error("Upload Error:", err);
          setError(`ファイルアップロードエラー: ${err.message}`);
        }
      };

      fileReader.readAsDataURL(file);
    } catch (err) {
      console.error("File processing error:", err);
      setError(`ファイル処理エラー: ${err.message}`);
    }
  };

  // チャットメッセージ送信
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    
    // クイズモード中の場合は回答をチェック
    if (isInQuizMode) {
      checkAnswer(userMessage);
      return;
    }
    
    // 問題評価コマンドの処理
    const ratingMatch = userMessage.match(/^(good|bad)(\d+)$/i);
    if (ratingMatch && currentQuestions.length > 0) {
      const rating = ratingMatch[1].toLowerCase();
      const questionIndex = parseInt(ratingMatch[2]);
      
      if (questionIndex >= 0 && questionIndex < currentQuestions.length) {
        rateQuestion(questionIndex, rating);
        return;
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `❌ 問題番号が無効です。0から${currentQuestions.length - 1}の範囲で指定してください。` 
        }]);
        return;
      }
    }
    
    setLoading(true);
    setError(null);

    try {
      // 認証トークンを取得
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.post(config.apiEndpoint, {
        message: userMessage,
        conversationHistory: messages,
        uploadedFiles: uploadedFiles // アップロードされたファイル情報を含める
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
      } else {
        setError('応答の取得に失敗しました');
      }
    } catch (err) {
      console.error("API Error:", err);
      setError(`エラーが発生しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ファイル削除機能
  const handleDeleteFile = (fileIndex) => {
    const deletedFileName = uploadedFiles[fileIndex]?.name || 'Unknown';
    setUploadedFiles(prev => prev.filter((_, index) => index !== fileIndex));
    
    // 削除メッセージを会話に追加
    setMessages(prev => [...prev, 
      { role: 'system', content: `🗑️ ファイル "${deletedFileName}" を削除しました。` }
    ]);
  };

  // 全ファイル削除機能
  const handleClearAllFiles = () => {
    const fileCount = uploadedFiles.length;
    setUploadedFiles([]);
    
    if (fileCount > 0) {
      setMessages(prev => [...prev, 
        { role: 'system', content: `🗑️ すべてのファイル（${fileCount}件）を削除しました。` }
      ]);
    }
  };

  // 会話をクリア
  const clearConversation = () => {
    // 現在のチャットを履歴に保存してから新しいチャットを開始
    createNewChat();
  };

  // ドラッグアンドドロップ機能（サイドバー用）
  const handleSidebarDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleSidebarDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleSidebarDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]); // 最初のファイルのみ処理
    }
  };

  // サイドバーの折りたたみ切り替え
  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // QA生成機能
  const generateQA = async () => {
    if (uploadedFiles.length === 0) {
      setError('QAを生成するためのファイルがアップロードされていません。');
      return;
    }

    setIsGeneratingQA(true);
    setError(null);

    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      // 全ファイルの内容を結合
      const combinedContent = uploadedFiles.map(file => 
        `--- ${file.name} ---\n${file.extractedText}`
      ).join('\n\n');

      const qaPrompt = `以下のファイル内容を基に、難易度「${difficulty}」の問題を10個作成してください。

【作成する問題の構成】
- 4択問題: 4個
- 複数選択問題: 4個
- 記述問題: 2個

【出力形式】
マークダウン形式で以下のように出力してください：

# 学習問題集

## 難易度: ${difficulty}

### 問題1 (4択)
質問内容

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: A**
**解説: 正解の理由を詳しく説明**

### 問題2 (4択)
質問内容

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: B**
**解説: 正解の理由を詳しく説明**

### 問題3 (4択)
質問内容

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: C**
**解説: 正解の理由を詳しく説明**

### 問題4 (4択)
質問内容

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: D**
**解説: 正解の理由を詳しく説明**

### 問題5 (複数選択)
質問内容（複数の正解があります）

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: A, C**
**解説: 正解の理由を詳しく説明**

### 問題6 (複数選択)
質問内容（複数の正解があります）

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: B, D**
**解説: 正解の理由を詳しく説明**

### 問題7 (複数選択)
質問内容（複数の正解があります）

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: A, B, C**
**解説: 正解の理由を詳しく説明**

### 問題8 (複数選択)
質問内容（複数の正解があります）

A) 選択肢1
B) 選択肢2  
C) 選択肢3
D) 選択肢4

**正解: B, C, D**
**解説: 正解の理由を詳しく説明**

### 問題9 (記述)
質問内容

**解答例:**
記述問題の模範解答

**採点ポイント:**
- ポイント1
- ポイント2

### 問題10 (記述)
質問内容

**解答例:**
記述問題の模範解答

**採点ポイント:**
- ポイント1
- ポイント2

---

ファイル内容:
${combinedContent}`;

      const response = await axios.post(config.apiEndpoint, {
        message: qaPrompt,
        conversationHistory: [],
        uploadedFiles: uploadedFiles
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        setGeneratedQA(response.data.response);
        
        // QAテキストから問題を解析
        const questions = parseQAText(response.data.response);
        setCurrentQuestions(questions);
        
        // QA情報をチャット履歴に保存するため、現在のチャットを更新
        
        // チャット履歴への自動保存のためにgeneratedQAを設定
        // これによりuseEffectでチャット履歴に保存される
        
        console.log('QA生成完了。解析された問題数:', questions.length);
        
        const successMessage = questions.length > 0 
          ? `📝 難易度「${difficulty}」のQA問題集が生成されました！\n\n` +
            `✅ ${questions.filter(q => q.type === 'multiple').length}個の4択問題\n` +
            `✅ ${questions.filter(q => q.type === 'multiple-select').length}個の複数選択問題\n` +
            `✅ ${questions.filter(q => q.type === 'written').length}個の記述問題\n\n` +
            `サイドバーからダウンロード・プレビューするか、「💬 チャットで問題に挑戦」ボタンでリアルタイム回答ができます。\n\n` +
            `📚 チャット履歴からいつでも再利用できます。`
          : `📝 QA問題集は生成されましたが、問題の解析に問題があります。プレビューで内容を確認してください。`;
        
        setMessages(prev => [...prev, 
          { role: 'system', content: successMessage }
        ]);
      } else {
        setError('QA生成に失敗しました');
      }
    } catch (err) {
      console.error("QA Generation Error:", err);
      setError(`QA生成エラー: ${err.message}`);
    } finally {
      setIsGeneratingQA(false);
    }
  };

  // QAテキストを解析して問題オブジェクトに変換
  const parseQAText = (qaText) => {
    const questions = [];
    
    console.log('QA解析開始。テキストの長さ:', qaText.length);
    console.log('QAテキストの先頭500文字:', qaText.substring(0, 500));
    
    // より多様なパターンで問題を分割（PPTファイル対応強化）
    const problemPatterns = [
      /###?\s*問題\s*(\d+)/gi,
      /##?\s*問題\s*(\d+)/gi,
      /問題\s*(\d+)/gi,
      /(\d+)[.．]\s*/gi,
      /Question\s*(\d+)/gi
    ];
    
    let sections = [];
    let maxSections = 0;
    
    // 最も多くの問題を認識できるパターンを選択
    problemPatterns.forEach((pattern, patternIndex) => {
      pattern.lastIndex = 0; // グローバル正規表現のリセット
      const testSections = qaText.split(pattern);
      console.log(`パターン${patternIndex + 1}での分割結果:`, testSections.length, '個のセクション');
      
      if (testSections.length > maxSections) {
        maxSections = testSections.length;
        sections = testSections;
      }
    });
    
    console.log('最終的な分割結果:', sections.length, '個のセクション');
    
    if (sections.length <= 1) {
      console.warn('問題の分割ができませんでした。別の方法を試します...');
      
      // フォールバック: より単純な分割方法を試す
      const simpleSplit = qaText.split(/(?=\d+[.．])/);
      if (simpleSplit.length > 1) {
        sections = simpleSplit;
        console.log('フォールバック分割で', sections.length, '個のセクションを取得');
      } else {
        // より積極的なフォールバック処理
        console.log('数字パターンでも分割できません。内容を詳細に分析します...');
        
        // 内容分析のため先頭部分をログ出力
        const lines = qaText.split('\n');
        console.log('QAテキストの全行数:', lines.length);
        lines.slice(0, 20).forEach((line, idx) => {
          console.log(`行${idx + 1}: "${line}"`);
        });
        
        // 特定のキーワードで分割を試す
        const keywordSplit = qaText.split(/(?=.*(問題|Question|選択肢|回答|答え|正解))/);
        if (keywordSplit.length > 1) {
          sections = keywordSplit.filter(s => s.trim());
          console.log('キーワード分割で', sections.length, '個のセクションを取得');
        } else {
          // 最終フォールバック: 改行ベースの分割
          const lines = qaText.split('\n').filter(line => line.trim());
          if (lines.length > 0) {
            sections = [qaText]; // 全体を1つのセクションとして処理
            console.log('全体を1つのセクションとして処理します');
          } else {
            return questions;
          }
        }
      }
    }
    
    // 問題セクションを解析
    sections.forEach((sectionContent, index) => {
      if (!sectionContent || !sectionContent.trim()) return;
      
      console.log(`セクション${index}の解析開始:`, sectionContent.substring(0, 200));
      console.log(`セクション${index}の全内容:\n`, sectionContent);
      
      const lines = sectionContent.trim().split('\n').filter(line => line.trim());
      if (lines.length === 0) return;
      
      console.log(`セクション${index}の行数:`, lines.length);
      lines.forEach((line, lineIdx) => {
        console.log(`  行${lineIdx + 1}: "${line}"`);
      });
      
      // 問題タイプを判定（より柔軟に）
      const hasChoices = /[A-D][)）]\s*/.test(sectionContent);
      const hasMultipleChoice = (sectionContent.match(/[A-D][)）]/g) || []).length >= 4;
      const isMultipleSelectQuestion = /複数選択/.test(sectionContent);
      const hasCorrectAnswer = /正解|答え|回答/.test(sectionContent);
      const hasExplanation = /解説|説明/.test(sectionContent);
      const hasWrittenElements = /記述|解答例|採点ポイント|模範解答/.test(sectionContent);
      
      console.log('問題タイプ判定:', {
        hasChoices,
        hasMultipleChoice,
        isMultipleSelectQuestion,
        hasCorrectAnswer,
        hasExplanation,
        hasWrittenElements,
        choiceCount: (sectionContent.match(/[A-D][)）]/g) || []).length
      });
      
      if (hasMultipleChoice && hasChoices) {
        // 4択問題または複数選択問題の解析
        const questionType = isMultipleSelectQuestion ? '複数選択問題' : '4択問題';
        console.log(`${questionType}として解析中...`);
        
        // 問題文を抽出（より柔軟なアプローチ）
        let questionText = '';
        
        // 1. 最初に全体から問題文を探す（選択肢より前の部分）
        const beforeChoicesMatch = sectionContent.match(/^(.*?)(?=[A-D][)）])/s);
        if (beforeChoicesMatch) {
          const beforeChoices = beforeChoicesMatch[1].trim();
          const beforeChoicesLines = beforeChoices.split('\n').filter(line => line.trim());
          
          // 問題文らしい行を探す（最長の行、または疑問符で終わる行を優先）
          let bestQuestion = '';
          for (let line of beforeChoicesLines) {
            const cleanLine = line.trim()
              .replace(/^\d+[.．]\s*/, '')
              .replace(/^(問題|Question)\s*\d*[.．:：]?\s*/i, '')
              .replace(/^\(4択\)/, '')
              .replace(/^4択問題/, '')
              .replace(/^\s*\(.*?\)/, '')
              .trim();
            
            if (cleanLine && 
                !cleanLine.match(/^[A-D][)）]/) && 
                !cleanLine.match(/^(正解|答え|解説|説明)[：:]/) &&
                !cleanLine.match(/^(学習問題集|難易度|###|##|#)/) &&
                cleanLine.length > 10) { // 十分な長さがある
              
              if (cleanLine.includes('？') || cleanLine.includes('?') || 
                  cleanLine.includes('ですか') || cleanLine.includes('でしょうか') ||
                  cleanLine.length > bestQuestion.length) {
                bestQuestion = cleanLine;
              }
            }
          }
          questionText = bestQuestion;
        }
        
        // 2. 上記で見つからない場合は、従来の方法でフォールバック
        if (!questionText) {
          for (let line of lines) {
            if (line.trim() && 
                !line.match(/^[A-D][)）]/) && 
                !line.match(/^(問題|Question)/i) &&
                !line.match(/^(正解|答え|解説|説明)[：:]/)) {
              questionText = line.trim()
                .replace(/^\d+[.．]\s*/, '')
                .replace(/^\(4択\)/, '')
                .replace(/^4択問題/, '')
                .replace(/^\s*\(.*?\)/, '')
                .trim();
              if (questionText.length > 5) break; // 短すぎる行は無視
            }
          }
        }
        
        console.log('抽出された問題文:', questionText);
        
        const options = [];
        let correctAnswer = '';
        let explanation = '';
        
        // 選択肢を取得（より柔軟なパターン）
        const choicePatterns = [
          /([A-D])[)）]\s*(.+)/g,
          /([A-D])[:：]\s*(.+)/g,
          /([A-D])\s*[.．]\s*(.+)/g
        ];
        
        console.log('選択肢抽出を開始...');
        
        choicePatterns.forEach((pattern, patternIdx) => {
          pattern.lastIndex = 0;
          console.log(`パターン${patternIdx + 1} (${pattern}) で検索中...`);
          let match;
          let matchCount = 0;
          while ((match = pattern.exec(sectionContent)) !== null) {
            matchCount++;
            console.log(`  マッチ${matchCount}: ${match[1]} -> "${match[2].trim()}"`);
            const choice = `${match[1]}) ${match[2].trim()}`;
            if (!options.some(opt => opt.startsWith(match[1]))) {
              options.push(choice);
              console.log(`    選択肢に追加: "${choice}"`);
            } else {
              console.log(`    既存の選択肢のためスキップ`);
            }
          }
          console.log(`パターン${patternIdx + 1}での総マッチ数:`, matchCount);
        });
        
        console.log('最終的に抽出された選択肢:', options);
        
        // 正解を取得（より柔軟なパターン）
        console.log('正解抽出を開始...');
        const correctPatterns = [
          /\*\*正解[：:]\s*([A-D](?:\s*,\s*[A-D])*)\*\*/i,  // 複数選択対応
          /正解[：:]\s*([A-D](?:\s*,\s*[A-D])*)/i,
          /答え[：:]\s*([A-D](?:\s*,\s*[A-D])*)/i,
          /回答[：:]\s*([A-D](?:\s*,\s*[A-D])*)/i,
          /([A-D](?:\s*,\s*[A-D])*)\s*が正解/i,
          /正解は\s*([A-D](?:\s*,\s*[A-D])*)/i,
          /\*\*([A-D](?:\s*,\s*[A-D])*)\*\*/i,
          /正しいのは\s*([A-D](?:\s*,\s*[A-D])*)/i
        ];
        
        for (const pattern of correctPatterns) {
          console.log(`正解パターン ${pattern} で検索中...`);
          const match = sectionContent.match(pattern);
          if (match) {
            correctAnswer = match[1].toUpperCase().replace(/\s+/g, '');
            console.log('正解を発見:', correctAnswer, 'マッチした文字列:', match[0]);
            break;
          }
        }
        
        // 解説を取得
        const explanationPatterns = [
          /\*\*解説[：:]\*\*\s*(.+?)(?=###|##|\*\*|$)/si,
          /解説[：:]\s*(.+?)(?=###|##|問題|$)/si,
          /説明[：:]\s*(.+?)(?=###|##|問題|$)/si
        ];
        
        for (const pattern of explanationPatterns) {
          const match = sectionContent.match(pattern);
          if (match) {
            explanation = match[1].trim().replace(/\n+$/, '');
            break;
          }
        }
        
        if (options.length >= 2 && correctAnswer) {
          // 問題文が空の場合は、デフォルトの問題文を設定
          if (!questionText || questionText.trim() === '') {
            questionText = '以下の選択肢から正しいものを選んでください。';
            console.log('問題文が空のため、デフォルト問題文を設定:', questionText);
          }
          
          // 選択肢が4個未満の場合は警告するが、問題として追加
          if (options.length < 4) {
            console.warn('選択肢が4個未満です:', options.length);
          }
          
          const newQuestion = {
            type: isMultipleSelectQuestion ? 'multiple-select' : 'multiple',
            question: questionText,
            options: options,
            correctAnswer: correctAnswer,
            explanation: explanation
          };
          
          questions.push(newQuestion);
          
          console.log(`${questionType}を追加しました:`, newQuestion);
        } else {
          console.warn(`${questionType}として処理できませんでした:`, {
            originalQuestionText: questionText || '(なし)',
            optionsCount: options.length,
            correctAnswer: correctAnswer || '(なし)',
            hasExplanation: !!explanation
          });
          console.warn(`${questionType}の必須要素が不足:`, {
            optionsCount: options.length,
            correctAnswer: !!correctAnswer,
            minimumRequirement: 'options >= 2 && correctAnswer'
          });
        }
        
      } else if (hasWrittenElements || lines.length > 0) {
        // 記述問題の解析
        console.log('記述問題として解析中...');
        
        // 記述問題の問題文を抽出（より柔軟なアプローチ）
        let writtenQuestionText = '';
        
        // 全体から問題文を探す
        const allLines = sectionContent.split('\n').filter(line => line.trim());
        for (let line of allLines) {
          const cleanLine = line.trim()
            .replace(/^\d+[.．]\s*/, '')
            .replace(/^(問題|Question)\s*\d*[.．:：]?\s*/i, '')
            .replace(/^\(記述\)/, '')
            .replace(/^記述問題/, '')
            .replace(/^\s*\(.*?\)/, '')
            .trim();
          
          if (cleanLine && 
              !cleanLine.match(/^(正解|答え|解説|説明|解答例|採点ポイント)[：:]/) &&
              !cleanLine.match(/^(学習問題集|難易度|###|##|#)/) &&
              cleanLine.length > 5) { // 十分な長さがある
            writtenQuestionText = cleanLine;
            console.log('記述問題の問題文候補:', writtenQuestionText);
            break;
          }
        }
        
        console.log('記述問題のクリーンアップ後問題文:', writtenQuestionText);
        
        let explanation = '';
        const points = [];
        
        // 解答例を取得
        const answerPatterns = [
          /\*\*解答例[：:]\*\*\s*(.+?)(?=\*\*採点ポイント[：:]|\*\*|###|##|$)/si,
          /解答例[：:]\s*(.+?)(?=採点ポイント[：:]|###|##|$)/si,
          /模範解答[：:]\s*(.+?)(?=採点ポイント[：:]|###|##|$)/si
        ];
        
        for (const pattern of answerPatterns) {
          const match = sectionContent.match(pattern);
          if (match) {
            explanation = match[1].trim();
            break;
          }
        }
        
        // 採点ポイントを取得
        const pointsPatterns = [
          /\*\*採点ポイント[：:]\*\*\s*(.+?)(?=###|##|$)/si,
          /採点ポイント[：:]\s*(.+?)(?=###|##|$)/si,
          /評価基準[：:]\s*(.+?)(?=###|##|$)/si
        ];
        
        for (const pattern of pointsPatterns) {
          const match = sectionContent.match(pattern);
          if (match) {
            const pointsText = match[1];
            const pointLines = pointsText.split('\n').filter(line => 
              line.trim() && (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('・') || line.trim().match(/^\d+/))
            );
            pointLines.forEach(point => {
              const cleanPoint = point.replace(/^[-•・\d+.]\s*/, '').trim();
              if (cleanPoint) points.push(cleanPoint);
            });
            break;
          }
        }
        
        // 問題文が空の場合でも、記述要素があれば問題として扱う
        if (!writtenQuestionText && (hasWrittenElements || explanation || points.length > 0)) {
          writtenQuestionText = 'この内容について記述してください。';
          console.log('記述問題の問題文が空のため、デフォルト問題文を設定:', writtenQuestionText);
        }
        
        if (writtenQuestionText) {
          const newQuestion = {
            type: 'written',
            question: writtenQuestionText,
            explanation: explanation,
            points: points
          };
          
          questions.push(newQuestion);
          
          console.log('記述問題を追加しました:', newQuestion);
        } else {
          console.warn('記述問題として処理できませんでした - 問題文が見つかりません');
        }
      }
    });
    
    console.log('最終的に解析された問題数:', questions.length);
    questions.forEach((q, i) => {
      console.log(`問題${i + 1}: ${q.type} - ${q.question?.substring(0, 50)}...`);
    });
    
    return questions;
  };

  // チャットで問題に挑戦を開始
  const startQuizInChat = () => {
    if (currentQuestions.length === 0) {
      setError('問題が生成されていません。まず「QA問題集を生成」ボタンを押してください。');
      return;
    }
    
    setIsInQuizMode(true);
    setCurrentQuestionIndex(0);
    setUserAnswers([]);
    
    // クイズ開始メッセージ
    const startMessage = `🎯 **クイズを開始します！**\n\n` +
                        `全${currentQuestions.length}問の問題に挑戦しましょう。\n` +
                        `一問ずつ答えていただき、すぐに結果をお伝えします。\n\n` +
                        `それでは、最初の問題です！`;
    
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: startMessage 
    }]);
    
    // すぐに最初の問題を表示
    setTimeout(() => {
      displayQuestion(0);
    }, 500);
  };

  // 記述問題の採点機能
  async function gradeEssayAnswer(userAnswer, question) {
    try {
      setLoading(true);
      
      // 採点中メッセージを表示
      const gradingMessage = `📝 **記述問題の回答を受け付けました**\n\n` +
                           `**あなたの回答**:\n${userAnswer}\n\n` +
                           `🔄 **採点中です。しばらくお待ちください...**`;
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: gradingMessage,
        isQuizResult: true
      }]);
      
      // 認証トークンを取得
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();
      
      // 採点リクエストを作成
      const gradingRequest = {
        userAnswer: userAnswer,
        question: question,
        points: question.points || [],
        explanation: question.explanation || ''
      };
      
      const gradingRequestMessage = `GRADE_ESSAY_ANSWER:${JSON.stringify(gradingRequest)}`;
      
      // APIに採点リクエストを送信
      const response = await axios.post(config.apiEndpoint, {
        message: gradingRequestMessage,
        conversationHistory: [],
        uploadedFiles: uploadedFiles
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        // 採点結果を表示
        const gradingResult = response.data.response;
        
        // 前の「採点中」メッセージを削除し、採点結果を追加
        setMessages(prev => {
          const filteredMessages = prev.filter(msg => !msg.content.includes('採点中です。しばらくお待ちください'));
          return [...filteredMessages, { 
            role: 'assistant', 
            content: gradingResult,
            isQuizResult: true,
            isEssayGrading: true,
            questionIndex: currentQuestionIndex
          }];
        });
        
        // 次の問題に進む処理
        setTimeout(() => {
          const nextIndex = currentQuestionIndex + 1;
          setCurrentQuestionIndex(nextIndex);
          
          if (nextIndex < currentQuestions.length) {
            // 次の問題を表示
            displayQuestion(nextIndex);
          } else {
            // 全問題完了
            setTimeout(() => {
              showQuizResults();
            }, 1000);
          }
        }, 3000); // 採点結果を確認する時間を長めに設定
        
      } else {
        // 採点エラーの場合、従来の表示方法にフォールバック
        const fallbackResult = `📝 **記述問題の回答を受け付けました**\n\n` +
                             `**あなたの回答**:\n${userAnswer}\n\n`;
        
        let fallbackContent = fallbackResult;
        if (question.explanation) {
          fallbackContent += `💡 **解答例**:\n${question.explanation}\n\n`;
        }
        
        if (question.points && question.points.length > 0) {
          fallbackContent += `**採点ポイント**:\n`;
          question.points.forEach((point, index) => {
            fallbackContent += `${index + 1}. ${point}\n`;
          });
        }
        
        // 「採点中」メッセージを削除し、フォールバック結果を表示
        setMessages(prev => {
          const filteredMessages = prev.filter(msg => !msg.content.includes('採点中です。しばらくお待ちください'));
          return [...filteredMessages, { 
            role: 'assistant', 
            content: fallbackContent,
            isQuizResult: true,
            questionIndex: currentQuestionIndex
          }];
        });
        
        // 次の問題に進む
        setTimeout(() => {
          const nextIndex = currentQuestionIndex + 1;
          setCurrentQuestionIndex(nextIndex);
          
          if (nextIndex < currentQuestions.length) {
            displayQuestion(nextIndex);
          } else {
            setTimeout(() => {
              showQuizResults();
            }, 1000);
          }
        }, 2000);
      }
      
    } catch (err) {
      console.error("Essay grading error:", err);
      
      // エラーの場合も従来の表示方法にフォールバック
      const fallbackResult = `📝 **記述問題の回答を受け付けました**\n\n` +
                           `**あなたの回答**:\n${userAnswer}\n\n` +
                           `⚠️ **採点機能でエラーが発生しました。解答例と採点ポイントを参考にしてください。**\n\n`;
      
      let fallbackContent = fallbackResult;
      if (question.explanation) {
        fallbackContent += `💡 **解答例**:\n${question.explanation}\n\n`;
      }
      
      if (question.points && question.points.length > 0) {
        fallbackContent += `**採点ポイント**:\n`;
        question.points.forEach((point, index) => {
          fallbackContent += `${index + 1}. ${point}\n`;
        });
      }
      
      // 「採点中」メッセージを削除し、エラーフォールバック結果を表示
      setMessages(prev => {
        const filteredMessages = prev.filter(msg => !msg.content.includes('採点中です。しばらくお待ちください'));
        return [...filteredMessages, { 
          role: 'assistant', 
          content: fallbackContent,
          isQuizResult: true,
          questionIndex: currentQuestionIndex
        }];
      });
      
      // 次の問題に進む
      setTimeout(() => {
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        
        if (nextIndex < currentQuestions.length) {
          displayQuestion(nextIndex);
        } else {
          setTimeout(() => {
            showQuizResults();
          }, 1000);
        }
      }, 2000);
      
    } finally {
      setLoading(false);
    }
  }

  // 問題を表示
  const displayQuestion = (questionIndex) => {
    if (questionIndex >= currentQuestions.length) {
      // 全問題完了
      showQuizResults();
      return;
    }
    
    const question = currentQuestions[questionIndex];
    
    if (!question || !question.question) {
      console.error('問題データが不正です:', question);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '❌ 問題の表示でエラーが発生しました。問題を再生成してください。' 
      }]);
      setIsInQuizMode(false);
      return;
    }
    
    const questionType = question.type === 'multiple' ? '4択問題' : 
                         question.type === 'multiple-select' ? '複数選択問題' : '記述問題';
    
    let questionText = `📝 **問題 ${questionIndex + 1}/${currentQuestions.length}** （${questionType}）\n\n`;
    questionText += `${question.question}\n\n`;
    
    if (question.type === 'multiple' || question.type === 'multiple-select') {
      // 4択問題または複数選択問題の選択肢を表示
      if (question.options && question.options.length === 4) {
        question.options.forEach(option => {
          questionText += `${option}\n`;
        });
        if (question.type === 'multiple-select') {
          questionText += '\n✏️ **回答方法**: 正解となる選択肢をすべて入力してください（例: A, C）';
        } else {
          questionText += '\n✏️ **回答方法**: A、B、C、D のいずれかを入力してください';
        }
      } else {
        console.error('問題の選択肢が不正です:', question.options);
        questionText += '❌ 選択肢の表示でエラーが発生しました。';
      }
    } else {
      // 記述問題の指示
      questionText += '✏️ **回答方法**: 自由に記述して回答してください';
    }
    
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: questionText,
      isQuizQuestion: true,
      questionIndex: questionIndex
    }]);
  };

  // 回答をチェック
  const checkAnswer = (userAnswer) => {
    const question = currentQuestions[currentQuestionIndex];
    const answer = {
      questionIndex: currentQuestionIndex,
      userAnswer: userAnswer,
      question: question
    };
    
    setUserAnswers(prev => [...prev, answer]);
    
    let resultText = '';
    let isCorrect = false;
    
    if (question.type === 'multiple' || question.type === 'multiple-select') {
      // 4択問題または複数選択問題の回答チェック
      if (question.type === 'multiple-select') {
        // 複数選択問題の場合
        const userChoices = userAnswer.toUpperCase().replace(/[）)\s]/g, '').split(',').sort().join(',');
        const correctChoices = question.correctAnswer.toUpperCase().replace(/[）)\s]/g, '').split(',').sort().join(',');
        
        isCorrect = userChoices === correctChoices;
        
        if (isCorrect) {
          resultText = '🎉 **正解です！** よくできました！\n\n';
          resultText += `✅ **あなたの回答**: ${question.correctAnswer}\n`;
        } else {
          resultText = '❌ **残念、不正解です**\n\n';
          resultText += `❌ **あなたの回答**: ${userAnswer}\n`;
          resultText += `✅ **正解**: ${question.correctAnswer}\n\n`;
        }
      } else {
        // 4択問題の場合
        const userChoice = userAnswer.toUpperCase().replace(/[）)]/g, '').trim();
        const correctChoice = question.correctAnswer.toUpperCase().replace(/[）)]/g, '').trim();
        
        isCorrect = userChoice === correctChoice;
        
        if (isCorrect) {
          resultText = '🎉 **正解です！** よくできました！\n\n';
          resultText += `✅ **あなたの回答**: ${question.correctAnswer}\n`;
        } else {
          resultText = '❌ **残念、不正解です**\n\n';
          resultText += `❌ **あなたの回答**: ${userAnswer}\n`;
          resultText += `✅ **正解**: ${question.correctAnswer}\n\n`;
        }
      }
      
      if (question.explanation) {
        resultText += `💡 **解説**:\n${question.explanation}`;
      }
      
    } else {
      // 記述問題の回答処理 - 採点機能を統合
      resultText = '📝 **記述問題の回答を受け付けました**\n\n';
      resultText += `**あなたの回答**:\n${userAnswer}\n\n`;
      
      // 採点処理を開始
      gradeEssayAnswer(userAnswer, question);
      return; // 採点結果を待つため、ここで処理を終了
    }
    
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: resultText,
      isQuizResult: true,
      isCorrect: isCorrect,
      questionIndex: currentQuestionIndex
    }]);
    
    // 次の問題へ進む
    setTimeout(() => {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      
      if (nextIndex < currentQuestions.length) {
        // 次の問題を表示
        displayQuestion(nextIndex);
      } else {
        // 全問題完了
        setTimeout(() => {
          showQuizResults();
        }, 1000);
      }
    }, 2000); // 回答確認のため少し長めの間隔
  };

  // クイズ結果を表示
  const showQuizResults = () => {
    const multipleChoiceAnswers = userAnswers.filter(a => a.question.type === 'multiple' || a.question.type === 'multiple-select');
    const correctAnswers = multipleChoiceAnswers.filter(a => {
      if (a.question.type === 'multiple-select') {
        const userChoices = a.userAnswer.toUpperCase().replace(/[）)\s]/g, '').split(',').sort().join(',');
        const correctChoices = a.question.correctAnswer.toUpperCase().replace(/[）)\s]/g, '').split(',').sort().join(',');
        return userChoices === correctChoices;
      } else {
        return a.userAnswer.toUpperCase() === a.question.correctAnswer.toUpperCase();
      }
    }).length;
    
    let resultText = `🎉 **クイズ完了！**\n\n`;
    resultText += `**選択問題の結果**: ${correctAnswers}/${multipleChoiceAnswers.length}問正解\n`;
    resultText += `**正答率**: ${Math.round((correctAnswers / multipleChoiceAnswers.length) * 100)}%\n\n`;
    
    if (correctAnswers === multipleChoiceAnswers.length) {
      resultText += `🏆 **パーフェクト！** 素晴らしい理解度です！`;
    } else if (correctAnswers >= multipleChoiceAnswers.length * 0.8) {
      resultText += `🌟 **よくできました！** 高い理解度を示しています。`;
    } else if (correctAnswers >= multipleChoiceAnswers.length * 0.6) {
      resultText += `👍 **まずまずです！** 復習すればさらに向上できます。`;
    } else {
      resultText += `📚 **もう一度復習しましょう！** 理解を深めるためにファイルを見直してみてください。`;
    }
    
    setMessages(prev => [...prev, { role: 'assistant', content: resultText }]);
    
    // クイズ完了後、問題評価UIを表示
    setTimeout(() => {
      showQuestionRatingUI();
    }, 1000);
    
    setIsInQuizMode(false);
  };

  // 問題評価UIを表示
  const showQuestionRatingUI = () => {
    let ratingMessage = `📊 **問題の評価をお願いします**\n\n`;
    ratingMessage += `各問題が学習に役立ったかどうか評価してください：\n\n`;
    
    currentQuestions.forEach((question, index) => {
      const currentRating = getQuestionRating(index);
      const questionTitle = question.question.length > 50 
        ? question.question.substring(0, 50) + '...' 
        : question.question;
      
      ratingMessage += `**問題${index + 1}**: ${questionTitle}\n`;
      
      if (currentRating) {
        const ratingEmoji = currentRating === 'good' ? '👍' : '👎';
        ratingMessage += `評価済み: ${ratingEmoji} ${currentRating === 'good' ? '役に立った' : '役に立たなかった'}\n\n`;
      } else {
        ratingMessage += `未評価 - 「good${index}」または「bad${index}」と入力して評価\n`;
        ratingMessage += `例: 問題${index + 1}が役に立った場合は「good${index}」と入力\n\n`;
      }
    });
    
    const stats = getRatingStats();
    if (stats.total > 0) {
      ratingMessage += `**現在の評価統計**: 👍${stats.good}個 / 👎${stats.bad}個 / 未評価${currentQuestions.length - stats.total}個\n\n`;
    }
    
    ratingMessage += `💡 **ヒント**: 問題番号は0から${currentQuestions.length - 1}です`;
    
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: ratingMessage,
      isQuestionRating: true
    }]);
  };

  // QAをマークダウンファイルとしてダウンロード
  const downloadQA = () => {
    if (!generatedQA) return;
    
    const blob = new Blob([generatedQA], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QA問題集_難易度${difficulty}_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // QAプレビューモーダルを開く
  const openQAPreview = () => {
    setShowQAModal(true);
  };

  // QAプレビューモーダルを閉じる
  const closeQAPreview = () => {
    setShowQAModal(false);
  };

  // チャット履歴管理機能
  const createNewChat = () => {
    // 現在のチャットを保存してから新しいチャットを開始
    if (messages.length > 0) {
      saveChatToHistory();
    }
    
    // 新しいチャットを開始
    const newChatId = Date.now();
    setCurrentChatId(newChatId);
    setMessages([]);
    setUploadedFiles([]);
    setGeneratedQA('');
    setCurrentQuestions([]);
    setQuestionRatings({}); // 評価データもクリア
    
    setMessages(prev => [...prev, { 
      role: 'system', 
      content: '🆕 新しいチャットを開始しました。ファイルをアップロードするか、メッセージを入力してください。' 
    }]);
  };

  const saveChatToHistory = () => {
    if (!currentChatId || messages.length === 0) return;
    
    // システムメッセージを除いた実際の会話があるかチェック
    const actualMessages = messages.filter(msg => msg.role !== 'system' || msg.content.includes('ファイル'));
    if (actualMessages.length === 0) return;
    
    const chatRecord = {
      id: currentChatId,
      timestamp: new Date().toISOString(),
      title: generateChatTitle(messages),
      messages: [...messages],
      uploadedFiles: [...uploadedFiles],
      generatedQA: generatedQA,
      currentQuestions: [...currentQuestions],
      questionRatings: Object.keys(questionRatings)
        .filter(key => key.startsWith(`${currentChatId}_`))
        .reduce((obj, key) => {
          obj[key] = questionRatings[key];
          return obj;
        }, {}),
      messageCount: messages.filter(msg => msg.role === 'user' || msg.role === 'assistant').length,
      fileCount: uploadedFiles.length,
      hasQA: !!generatedQA,
      ratingStats: getRatingStats()
    };
    
    setChatHistory(prev => {
      const existingIndex = prev.findIndex(chat => chat.id === currentChatId);
      if (existingIndex >= 0) {
        // 既存のチャットを更新
        const newHistory = [...prev];
        newHistory[existingIndex] = chatRecord;
        return newHistory;
      } else {
        // 新しいチャットを追加
        return [chatRecord, ...prev];
      }
    });
  };

  const generateChatTitle = (msgs) => {
    // ユーザーの最初のメッセージからタイトルを生成
    const firstUserMessage = msgs.find(msg => msg.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content;
      if (content.length > 30) {
        return content.substring(0, 30) + '...';
      }
      return content;
    }
    
    // ファイルがアップロードされている場合
    if (uploadedFiles.length > 0) {
      return `📁 ${uploadedFiles[0].name}${uploadedFiles.length > 1 ? ` 他${uploadedFiles.length - 1}件` : ''}`;
    }
    
    return `チャット ${new Date().toLocaleString()}`;
  };

  const loadChatFromHistory = (chatRecord) => {
    // 現在のチャットを保存
    if (messages.length > 0 && currentChatId) {
      saveChatToHistory();
    }
    
    // 選択されたチャットを読み込み
    setCurrentChatId(chatRecord.id);
    setMessages(chatRecord.messages);
    setUploadedFiles(chatRecord.uploadedFiles);
    setGeneratedQA(chatRecord.generatedQA || '');
    setCurrentQuestions(chatRecord.currentQuestions || []);
    
    // 問題評価データも復元
    if (chatRecord.questionRatings) {
      setQuestionRatings(prev => ({
        ...prev,
        ...chatRecord.questionRatings
      }));
    }
    
    setShowChatHistory(false);
    
    const loadMessage = `📖 **チャット履歴から読み込みました**\n\n` +
                       `📅 **作成日時**: ${new Date(chatRecord.timestamp).toLocaleString()}\n` +
                       `💬 **メッセージ数**: ${chatRecord.messageCount}件\n` +
                       `📁 **ファイル数**: ${chatRecord.fileCount}件\n` +
                       `📝 **QA問題集**: ${chatRecord.hasQA ? 'あり' : 'なし'}\n\n` +
                       `過去の会話とファイルが復元されました。`;
    
    // 一時的にロードメッセージを表示してから削除
    setMessages(prev => [...prev, { 
      role: 'system', 
      content: loadMessage 
    }]);
    
    setTimeout(() => {
      setMessages(prev => prev.filter(msg => msg.content !== loadMessage));
    }, 3000);
  };

  const deleteChatFromHistory = (chatId) => {
    setChatHistory(prev => prev.filter(chat => chat.id !== chatId));
    
    if (currentChatId === chatId) {
      createNewChat();
    }
    
    setMessages(prev => [...prev, { 
      role: 'system', 
      content: '🗑️ チャット履歴から削除しました。' 
    }]);
  };

  const clearChatHistory = () => {
    setChatHistory([]);
    createNewChat();
    
    setMessages(prev => [...prev, { 
      role: 'system', 
      content: '🗑️ チャット履歴をすべて削除しました。' 
    }]);
  };

  const toggleChatHistory = () => {
    setShowChatHistory(!showChatHistory);
  };

  const downloadQAFromChat = (chatRecord) => {
    if (!chatRecord.generatedQA) return;
    
    const blob = new Blob([chatRecord.generatedQA], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QA問題集_${chatRecord.title.replace(/[^\w\s]/gi, '')}_${new Date(chatRecord.timestamp).toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 問題評価機能
  const rateQuestion = (questionIndex, rating) => {
    const ratingKey = `${currentChatId}_${questionIndex}`;
    setQuestionRatings(prev => ({
      ...prev,
      [ratingKey]: rating
    }));
    
    // 評価完了の通知は削除（ボタンの状態変化のみで表現）
  };

  // 問題の評価状態を取得
  const getQuestionRating = (questionIndex) => {
    const ratingKey = `${currentChatId}_${questionIndex}`;
    return questionRatings[ratingKey] || null;
  };

  // 評価統計を取得
  const getRatingStats = () => {
    const ratings = Object.keys(questionRatings)
      .filter(key => key.startsWith(`${currentChatId}_`))
      .map(key => questionRatings[key]);
    
    return {
      total: ratings.length,
      good: ratings.filter(r => r === 'good').length,
      bad: ratings.filter(r => r === 'bad').length
    };
  };



  return (
    <div className="App">
      <header className="App-header">
        <h1>チャットボット</h1>
        <div className="header-buttons">
          <button className="sidebar-toggle" onClick={toggleSidebar}>
            {sidebarCollapsed ? 'ファイル表示' : 'ファイル非表示'}
          </button>
          <button className="chat-history-toggle" onClick={toggleChatHistory}>
            💬 チャット履歴 ({chatHistory.length})
          </button>
          <button className="new-chat-button" onClick={createNewChat}>
            🆕 新しいチャット
          </button>
          <button className="clear-button" onClick={clearConversation}>
            会話をクリア
          </button>
          <button className="logout-button" onClick={signOut}>
            ログアウト ({user.username})
          </button>
        </div>
      </header>
      
      <div className="main-content">
        {/* サイドバー */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h3 className="sidebar-title">ファイル・チャット管理</h3>
          </div>
          
          {/* 現在のチャット情報 */}
          <div className="current-chat-info">
            <div className="current-chat-header">💬 現在のチャット</div>
            <div className="current-chat-details">
              <div className="current-chat-stats">
                📊 メッセージ: {messages.filter(m => m.role === 'user' || m.role === 'assistant').length}件
              </div>
              <div className="current-chat-stats">
                📁 ファイル: {uploadedFiles.length}件
              </div>
              <div className="current-chat-stats">
                📝 QA問題集: {generatedQA ? 'あり' : 'なし'}
              </div>
              {currentQuestions.length > 0 && (() => {
                const stats = getRatingStats();
                return (
                  <div className="current-chat-stats">
                    ⭐ 問題評価: 👍{stats.good} / 👎{stats.bad} / 未評価{currentQuestions.length - stats.total}
                  </div>
                );
              })()}
            </div>
            <div className="current-chat-actions">
              <button 
                className="chat-manage-btn save"
                onClick={() => saveChatToHistory()}
                disabled={messages.length === 0}
                title="現在のチャットを履歴に保存"
              >
                💾 保存
              </button>
              <button 
                className="chat-manage-btn new"
                onClick={createNewChat}
                title="新しいチャットを開始"
              >
                🆕 新規
              </button>
              <button 
                className="chat-manage-btn history"
                onClick={toggleChatHistory}
                title="チャット履歴を表示"
              >
                📚 履歴
              </button>
            </div>
          </div>
          
          {/* ファイルドロップゾーン */}
          <div 
            className={`file-drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleSidebarDragOver}
            onDragLeave={handleSidebarDragLeave}
            onDrop={handleSidebarDrop}
          >
            <div className="file-drop-zone-content">
              <span className="file-drop-zone-icon">📁</span>
              <p className="file-drop-zone-text">
                ファイルをここにドラッグ&ドロップ<br/>
                (PDF, PPT, PPTX, DOC, DOCX, TXT)
              </p>
            </div>
          </div>

          {/* アップロード済みファイル一覧 */}
          <div className="uploaded-files-sidebar">
            {uploadedFiles.length > 0 ? (
              <div className="files-list-container">
                <ul className="uploaded-files-list">
                  {uploadedFiles.map((file, index) => (
                    <li key={index} className="uploaded-file-item">
                      <div className="file-item-header">
                        <span className="file-item-name">{file.name}</span>
                        <span className="file-item-status">✓ 処理済み</span>
                      </div>
                      <div className="file-item-actions">
                        <button 
                          className="file-action-btn preview"
                          onClick={() => {
                            setMessages(prev => [...prev, 
                              { role: 'system', content: `ファイル "${file.name}" の内容:\n\n${file.extractedText.substring(0, 500)}${file.extractedText.length > 500 ? '...' : ''}` }
                            ]);
                          }}
                          title="ファイル内容を表示"
                        >
                          内容表示
                        </button>
                        <button 
                          className="file-action-btn delete"
                          onClick={() => handleDeleteFile(index)}
                          title="このファイルを削除"
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button 
                  className="clear-all-btn"
                  onClick={handleClearAllFiles}
                  title="すべてのファイルを削除"
                >
                  すべて削除 ({uploadedFiles.length}件)
                </button>
              </div>
            ) : (
              <div className="files-list-container">
                <p style={{color: '#6c757d', fontSize: '14px', textAlign: 'center', margin: '20px 0'}}>
                  アップロードされたファイルはありません
                </p>
              </div>
            )}
          </div>
            
          {/* QA生成機能 - サイドバーの下部に固定 */}
          <div className="qa-generation-section">
            <div className="qa-generation-header">QA問題集生成</div>
            
            <div className="difficulty-selector">
              <label className="difficulty-label">難易度:</label>
              <select 
                className="difficulty-select" 
                value={difficulty} 
                onChange={(e) => setDifficulty(e.target.value)}
              >
                <option value="低">低 (基本的な内容)</option>
                <option value="中">中 (標準的な内容)</option>
                <option value="高">高 (応用・発展的な内容)</option>
              </select>
            </div>

            <button 
              className="generate-qa-btn"
              onClick={generateQA}
              disabled={isGeneratingQA || uploadedFiles.length === 0}
            >
              {isGeneratingQA ? 'QA生成中...' : 'QA問題集を生成'}
            </button>

            {isGeneratingQA && (
              <div className="qa-status">
                4択問題4個、複数選択問題4個、記述問題2個を生成中...
              </div>
            )}

            {generatedQA && (
              <div className="qa-actions">
                <button 
                  className="download-qa-btn"
                  onClick={downloadQA}
                >
                  📄 マークダウンでダウンロード
                </button>
                <button 
                  className="preview-qa-btn"
                  onClick={openQAPreview}
                >
                  👁️ 内容をプレビュー
                </button>
                <button 
                  className="chat-quiz-btn"
                  onClick={startQuizInChat}
                  disabled={isInQuizMode}
                >
                  {isInQuizMode ? '問題実行中...' : '💬 チャットで問題に挑戦'}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* チャットエリア */}
        <main className="chat-container">
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="welcome-message">
                <h2>チャットボットへようこそ！</h2>
                <p>左のサイドバーにファイルをドラッグ&ドロップするか、メッセージを入力してください。</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`message ${msg.role} ${msg.isQuizQuestion ? 'quiz-question' : ''} ${msg.isQuizResult ? (msg.isEssayGrading ? 'quiz-result essay-grading' : msg.isCorrect ? 'quiz-result correct' : 'quiz-result incorrect') : ''} ${msg.isQuestionRating ? 'question-rating-ui' : ''}`}>
                  <div className="message-content">
                    {msg.content.split('\n').map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                  
                  {/* 回答結果の後に評価ボタンを表示 */}
                  {msg.isQuizResult && typeof msg.questionIndex === 'number' && (
                    <div className="question-rating-buttons">
                      <div className="rating-label">この問題の評価:</div>
                      <div className="rating-buttons">
                        <button 
                          className={`rating-btn good ${getQuestionRating(msg.questionIndex) === 'good' ? 'selected' : ''}`}
                          onClick={() => rateQuestion(msg.questionIndex, 'good')}
                          title="役に立った"
                        >
                          👍 役に立った
                        </button>
                        <button 
                          className={`rating-btn bad ${getQuestionRating(msg.questionIndex) === 'bad' ? 'selected' : ''}`}
                          onClick={() => rateQuestion(msg.questionIndex, 'bad')}
                          title="役に立たなかった"
                        >
                          👎 役に立たなかった
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            
            {loading && (
              <div className="message assistant loading">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
            
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          {/* クイズモード中の進行状況表示 */}
          {isInQuizMode && (
            <div className="quiz-progress">
              📊 クイズ進行中: {currentQuestionIndex + 1}/{currentQuestions.length}問目
              {userAnswers.length > 0 && (
                <span> • 正解数: {userAnswers.filter(a => 
                  a.question.type === 'multiple' && 
                  a.userAnswer.toUpperCase() === a.question.correctAnswer.toUpperCase()
                ).length}/{userAnswers.filter(a => a.question.type === 'multiple').length}</span>
              )}
              <button 
                className="quiz-exit-btn"
                onClick={() => {
                  setIsInQuizMode(false);
                  setMessages(prev => [...prev, { role: 'system', content: '❌ クイズを中断しました。' }]);
                }}
                title="クイズを終了"
              >
                ❌ 終了
              </button>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="input-form">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isInQuizMode ? "回答を入力してください..." : "メッセージを入力..."}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {isInQuizMode ? '回答' : '送信'}
            </button>
          </form>
        </main>
      </div>

      {/* QAプレビューモーダル */}
      {showQAModal && (
        <div className="qa-modal-overlay" onClick={closeQAPreview}>
          <div className="qa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qa-modal-header">
              <h3 className="qa-modal-title">QA問題集プレビュー</h3>
              <button className="qa-modal-close" onClick={closeQAPreview}>
                ×
              </button>
            </div>
            <div className="qa-modal-content">
              {generatedQA}
            </div>
          </div>
        </div>
      )}

      {/* チャット履歴パネル */}
      {showChatHistory && (
        <div className="chat-history-overlay" onClick={() => setShowChatHistory(false)}>
          <div className="chat-history-panel" onClick={(e) => e.stopPropagation()}>
            <div className="chat-history-header">
              <h3 className="chat-history-title">💬 チャット履歴</h3>
              <div className="chat-history-controls">
                <button 
                  className="new-chat-btn"
                  onClick={createNewChat}
                  title="新しいチャットを開始"
                >
                  🆕 新しいチャット
                </button>
                {chatHistory.length > 0 && (
                  <button 
                    className="clear-history-btn"
                    onClick={clearChatHistory}
                    title="履歴をすべて削除"
                  >
                    🗑️ すべて削除
                  </button>
                )}
                <button className="chat-history-close" onClick={() => setShowChatHistory(false)}>
                  ×
                </button>
              </div>
            </div>
            <div className="chat-history-content">
              {chatHistory.length === 0 ? (
                <div className="chat-history-empty">
                  <p>まだチャット履歴がありません。</p>
                  <p>会話を開始すると、ここに履歴が表示されます。</p>
                </div>
              ) : (
                <div className="chat-history-list">
                  {chatHistory.map((chatRecord) => (
                    <div key={chatRecord.id} className="chat-history-item">
                      <div className="chat-record-header">
                        <div className="chat-record-info">
                          <div className="chat-record-title">
                            💬 {chatRecord.title}
                          </div>
                          <div className="chat-record-date">
                            📅 {new Date(chatRecord.timestamp).toLocaleString()}
                          </div>
                          <div className="chat-record-stats">
                            📊 メッセージ:{chatRecord.messageCount} / ファイル:{chatRecord.fileCount} / QA:{chatRecord.hasQA ? 'あり' : 'なし'}
                            {chatRecord.ratingStats && chatRecord.ratingStats.total > 0 && (
                              <span> / 評価: 👍{chatRecord.ratingStats.good} 👎{chatRecord.ratingStats.bad}</span>
                            )}
                          </div>
                        </div>
                        {currentChatId === chatRecord.id && (
                          <div className="chat-record-current">現在のチャット</div>
                        )}
                      </div>
                      
                      {/* ファイル一覧表示 */}
                      {chatRecord.uploadedFiles.length > 0 && (
                        <div className="chat-record-files">
                          <div className="chat-files-header">📁 アップロードファイル:</div>
                          <div className="chat-files-list">
                            {chatRecord.uploadedFiles.map((file, index) => (
                              <span key={index} className="chat-file-tag">
                                {file.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="chat-record-actions">
                        <button 
                          className="chat-action-btn load"
                          onClick={() => loadChatFromHistory(chatRecord)}
                          title="このチャットを読み込む"
                        >
                          📖 読み込み
                        </button>
                        {chatRecord.hasQA && (
                          <button 
                            className="chat-action-btn download"
                            onClick={() => downloadQAFromChat(chatRecord)}
                            title="QA問題集をダウンロード"
                          >
                            📄 QAダウンロード
                          </button>
                        )}
                        <button 
                          className="chat-action-btn delete"
                          onClick={() => deleteChatFromHistory(chatRecord.id)}
                          title="履歴から削除"
                        >
                          🗑️ 削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <ChatInterface signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;