import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// "훈프로 코칭AI" RAG 챗봇 통합 API
// Vercel Hobby 함수 개수 제한(12개) 때문에 action 파라미터로 통합
//  - action=ask      (수강생) 질문 → 지식 검색 → 훈프로 말투 답변
//  - action=feedback (수강생) 답변 👍👎 피드백
//  - action=status   (전체)   기능 공개 여부 조회 (탭 노출 판단용)
//  - action=ingest   (관리자) 자료 업로드(청크 분할 + 임베딩 저장)
//  - action=docs     (관리자) 자료 목록
//  - action=doc      (관리자) 자료 원문 조회 (수정 화면용)
//  - action=update   (관리자) 자료 수정 (원문 교체 + 재청크 + 재임베딩)
//  - action=delete   (관리자) 자료 삭제
//  - action=logs     (관리자) 질문/답변 로그
//  - action=toggle   (관리자) 수강생 공개 ON/OFF

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const EMBEDDING_MODEL = 'text-embedding-3-small';
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';
const MATCH_COUNT = 6;
const MIN_SIMILARITY = 0.25;
const MAX_QUESTION_LENGTH = 500;
const MAX_INGEST_CHARS = 300_000;
const CHUNK_SIZE = 900; // 한 청크 최대 글자 수
const CHUNK_OVERLAP = 120;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
};

// 민감 주제: LLM 호출 없이 직접 문의 유도 (환불/계정정지/세무)
const SENSITIVE_PATTERNS: { pattern: RegExp; topic: string }[] = [
  { pattern: /환불|환급|수강\s*취소|결제\s*취소/, topic: '환불/결제' },
  { pattern: /계정\s*정지|계정\s*제한|어카운트\s*정지|판매\s*정지|영구\s*정지|아이디\s*정지/, topic: '계정 정지' },
  { pattern: /세무|세금\s*신고|종합\s*소득세|부가세|부가가치세|사업자\s*세금|절세/, topic: '세무' },
];

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ── 수강생 공개 여부 (app_config.qa_enabled, 기본 OFF — 자료가 쌓일 때까지 관리자 전용) ──
const QA_CONFIG_TTL_MS = 30_000;
let cachedQaEnabled: boolean | null = null;
let qaConfigExpiresAt = 0;

async function getQaEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedQaEnabled !== null && now < qaConfigExpiresAt) return cachedQaEnabled;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'qa_enabled')
      .maybeSingle();
    if (error) throw error;
    cachedQaEnabled = data?.value === 'true';
    qaConfigExpiresAt = now + QA_CONFIG_TTL_MS;
    return cachedQaEnabled;
  } catch {
    return cachedQaEnabled ?? false;
  }
}

function verifyToken(req: VercelRequest): any | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return null;
  }
}

function getOpenAiKey(): string | undefined {
  return process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
}

// ── 개인정보 마스킹 (카톡 원본 업로드 대비: 연락처/이메일/계좌 자동 제거) ──
function maskSensitiveInfo(text: string): string {
  return text
    .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
    .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[연락처]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[이메일]')
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[주민번호]')
    .replace(/\b\d{3,6}[-\s]\d{2,6}[-\s]\d{4,8}\b/g, '[계좌번호]');
}

// 카톡 대화 내보내기의 수강생 이름 마스킹: "[홍길동] [오후 3:12]" → "[수강생] [오후 3:12]"
// 훈프로(강사) 발화는 유지해 말투 학습 소스로 쓸 수 있게 함
function maskKakaoNames(text: string): string {
  return text.replace(/\[([^\[\]\n]{1,20})\]\s*(\[(?:오전|오후)\s*\d{1,2}:\d{2}\])/g, (_m, name: string, time: string) => {
    const isInstructor = /훈프로|훈\s*프로|쇼크트리/.test(name);
    return `[${isInstructor ? '훈프로' : '수강생'}] ${time}`;
  });
}

// ── 청크 분할 ──
// 빈 줄(문단) 경계를 우선하되, 강의 정리본처럼 빈 줄 없이 한 줄씩 이어지는
// 자료는 줄 경계에서 자른다. 주제 중간이 뚝 잘리지 않도록 앞 청크 꼬리를 중첩.
function chunkText(text: string): string[] {
  // 1) 빈 줄 기준 블록 → 긴 블록은 줄 단위로 재분할해 "단위" 목록을 만든다
  const units: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length <= CHUNK_SIZE) {
      units.push(trimmed);
      continue;
    }
    let current = '';
    for (let line of trimmed.split('\n')) {
      line = line.trim();
      if (!line) continue;
      // 한 줄 자체가 청크보다 길면 문장/공백 경계에서 강제 분할
      while (line.length > CHUNK_SIZE) {
        let cut = line.lastIndexOf('. ', CHUNK_SIZE);
        if (cut < CHUNK_SIZE * 0.5) cut = line.lastIndexOf(' ', CHUNK_SIZE);
        if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
        if (current) { units.push(current.trim()); current = ''; }
        units.push(line.slice(0, cut).trim());
        line = line.slice(Math.max(0, cut - CHUNK_OVERLAP)).trim();
      }
      if (current && current.length + line.length + 1 > CHUNK_SIZE) {
        units.push(current.trim());
        current = current.slice(-CHUNK_OVERLAP) + '\n' + line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    if (current.trim()) units.push(current.trim());
  }

  // 2) 작은 단위들을 청크 크기 근처까지 이어붙인다 (경계에는 꼬리 중첩)
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > CHUNK_SIZE) {
      chunks.push(current.trim());
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + unit;
    } else {
      current = current ? current + '\n\n' + unit : unit;
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks.filter(c => c.length > 20);
}

// ── 질문에서 핵심 단어 추출 (키워드 보조 검색용) ──
const QUESTION_STOPWORDS = new Set([
  '어떻게', '어떤', '어떻', '무엇', '뭐', '뭔가요', '왜', '언제', '어디', '얼마',
  '하나요', '인가요', '있나요', '없나요', '되나요', '할까요', '좋나요', '해야',
  '해요', '합니다', '주세요', '알려주세요', '궁금합니다', '궁금해요', '방법',
  '대해', '대해서', '관련', '제가', '저는', '혹시', '그리고', '그런데', '쿠팡',
]);

function extractKeywords(question: string): string[] {
  const words = question
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(w => w.replace(/(은|는|이|가|을|를|의|에|로|으로|에서|도|만|이란|란|랑|과|와)$/u, ''))
    .filter(w => w.length >= 2 && !QUESTION_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 5);
}

// ── 키워드 보조 검색: 질문의 핵심 단어가 그대로 들어간 청크를 찾는다 ──
// (벡터 검색이 놓치는 "상품명" 같은 정확 일치 자료를 보강)
async function keywordSearch(keywords: string[], limit: number): Promise<any[]> {
  if (keywords.length === 0) return [];
  const orExpr = keywords.map(k => `content.ilike.%${k}%`).join(',');
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('id, doc_id, content, knowledge_docs(title, source_type)')
    .or(orExpr)
    .limit(40);
  if (error || !data) return [];

  // 포함된 키워드 수가 많은 청크 우선
  return data
    .map((row: any) => ({
      chunk_id: row.id,
      doc_id: row.doc_id,
      doc_title: row.knowledge_docs?.title || '',
      source_type: row.knowledge_docs?.source_type || 'lecture',
      content: row.content,
      similarity: null,
      _hits: keywords.filter(k => row.content.includes(k)).length,
    }))
    .sort((a: any, b: any) => b._hits - a._hits)
    .slice(0, limit);
}

// ── OpenAI 임베딩 (배치) ──
async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = getOpenAiKey();
  if (!apiKey) throw new Error('OPENAIAPIKEY가 설정되지 않았습니다.');

  const embeddings: number[][] = [];
  const BATCH = 100;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    const data: any = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `임베딩 생성 실패 (HTTP ${res.status})`);
    }
    const sorted = [...(data?.data || [])].sort((a: any, b: any) => a.index - b.index);
    for (const item of sorted) embeddings.push(item.embedding);
  }
  if (embeddings.length !== texts.length) throw new Error('임베딩 결과 개수가 일치하지 않습니다.');
  return embeddings;
}

const NOT_COVERED_ANSWER =
  '음, 이 부분은 아직 강의 자료에서 다루지 않은 내용이라 함부로 답변드리기 어렵네요. 🙏\n\n' +
  '괜히 부정확한 답변으로 혼란을 드리는 것보다, 커뮤니티(단톡방)에 질문 남겨주시면 제가 직접 확인하고 답변드릴게요. ' +
  '좋은 질문은 강의 자료에도 반영하겠습니다!';

function sensitiveAnswer(topic: string): string {
  return `${topic} 관련 문의는 사안마다 상황이 달라서 AI 답변으로 안내드리기 어려운 주제예요. 🙏\n\n` +
    '정확한 처리를 위해 관리자(훈프로)에게 직접 문의 남겨주세요. 커뮤니티 공지에 있는 문의 채널로 연락 주시면 확인 후 답변드리겠습니다.';
}

const SYSTEM_PROMPT = `당신은 쿠팡 셀러 강의를 운영하는 강사 '훈프로'입니다. 수강생의 쿠팡 판매 관련 질문에 답변합니다.

[말투 규칙]
- 친근하고 시원시원한 존댓말. 수강생을 격려하는 톤. ("~하시면 됩니다", "~해보세요", "핵심은 이겁니다")
- 실전 경험자답게 결론부터 명확하게. 장황한 서론 금지.
- 적절한 곳에 이모지 1~2개 정도만 가볍게 사용.

[답변 규칙 — 반드시 지킬 것]
1. 아래 [강의 자료]에 있는 내용만 근거로 답변합니다. 자료에 없는 내용은 일반 상식으로도 절대 채워 넣지 않습니다.
2. 질문과 직접 관련된 내용이 자료에 있으면 그 자료의 구체적인 수치·순서·예시를 그대로 살려서 답합니다. (예: 자료에 6단 구성이 있으면 6단을 다 언급)
3. 자료에 질문과 관련된 내용이 전혀 없으면 일반론을 늘어놓지 말고 "이 부분은 강의에서 자세히 다루지 않았으니 커뮤니티에 질문 남겨주세요"라고만 안내합니다.
4. 환불, 계정 정지, 세무 관련 질문은 답변하지 말고 관리자에게 직접 문의하도록 안내합니다.
5. 답변은 한국어로, 핵심 위주로 간결하게 (필요하면 번호/불릿 사용).
6. 자료 제목, 강의 회차, 출처는 답변에 표시하지 않습니다.
7. 자료에 영어 약칭으로 적힌 일반 단어는 자연스러운 한글 표기로 바꿔 말합니다. (예: '반팔 T' → '반팔 티', 'T셔츠' → '티셔츠') 단, 실제로 영어로 입력해야 하는 설정값(색상 옵션 Black/White 등)과 고유명사·서비스명은 그대로 둡니다.`;

// ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = verifyToken(req);
  if (!decoded) return res.status(401).json({ error: '인증이 필요합니다. 다시 로그인해주세요.' });

  const action = (req.query.action as string) || req.body?.action || 'ask';
  const isAdmin = decoded.isAdmin === true;

  try {
    switch (action) {
      case 'ask':
        return await handleAsk(req, res, decoded);
      case 'feedback':
        return await handleFeedback(req, res, decoded);
      case 'status': {
        const enabled = await getQaEnabled();
        return res.status(200).json({ enabled, canUse: isAdmin || enabled });
      }
      case 'toggle': {
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const enabled = req.body?.enabled === true;
        const { error } = await supabase.from('app_config').upsert(
          [{ key: 'qa_enabled', value: enabled ? 'true' : 'false', updated_at: new Date().toISOString() }],
          { onConflict: 'key' }
        );
        if (error) return res.status(500).json({ error: '설정 저장에 실패했습니다.' });
        cachedQaEnabled = enabled;
        qaConfigExpiresAt = Date.now() + QA_CONFIG_TTL_MS;
        return res.status(200).json({ enabled, message: enabled ? '수강생에게 공개됐습니다.' : '수강생 사용이 중지됐습니다. (관리자는 계속 사용 가능)' });
      }
      case 'ingest':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleIngest(req, res, decoded);
      case 'docs':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleDocs(req, res);
      case 'doc':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleDoc(req, res);
      case 'update':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleUpdate(req, res);
      case 'delete':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleDelete(req, res);
      case 'logs':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleLogs(req, res);
      default:
        return res.status(400).json({ error: '알 수 없는 action입니다.' });
    }
  } catch (error: any) {
    console.error(`QA ${action} failed:`, error);
    return res.status(500).json({ error: error?.message || '서버 오류' });
  }
}

// ── 수강생: 질문하기 ──
async function handleAsk(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 수강생 공개 OFF일 때는 관리자만 사용 가능 (자료가 쌓일 때까지 잠금)
  if (!decoded.isAdmin && !(await getQaEnabled())) {
    return res.status(403).json({ error: '아직 준비 중인 기능입니다. 오픈 소식을 기다려주세요!' });
  }

  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '질문을 입력해주세요.' });
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `질문은 ${MAX_QUESTION_LENGTH}자 이내로 입력해주세요.` });
  }


  // 유료화 게이트 — billing_enforced가 켜지면 유효한 구독 없이는 사용 불가 (api/usage.ts와 동일 기준)
  if (!decoded.isAdmin) {
    const { data: enforcedCfg } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'billing_enforced')
      .maybeSingle();
    if (enforcedCfg?.value === 'true') {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', decoded.userId)
        .maybeSingle();
      if (!sub || !['trial', 'active', 'past_due'].includes(sub.status)) {
        return res.status(402).json({
          error: '구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.',
          subscriptionRequired: true,
        });
      }
    }
  }

  // 민감 주제는 토큰/사용량 소모 없이 직접 문의 안내
  const sensitive = SENSITIVE_PATTERNS.find(s => s.pattern.test(question));
  if (sensitive) {
    const answer = sensitiveAnswer(sensitive.topic);
    const { data: log } = await supabase
      .from('qa_logs')
      .insert({ user_id: decoded.userId, question, answer, sources: [], matched: false, model: 'rule-sensitive' })
      .select('id')
      .single();
    return res.status(200).json({ answer, sources: [], matched: false, logId: log?.id ?? null });
  }

  // 코칭AI는 일일 한도가 없다. 텍스트라 원가가 낮고, 많이 쓸수록 훈프로
  // 노하우에 대한 의존이 깊어져 이탈이 줄어든다. 다만 사용량은 남겨
  // 관리자 원가 현황에서 볼 수 있게 한다 (한도 0 = 무제한).
  if (!decoded.isAdmin) {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST 자정 기준
    let qaLimit = 100;
    try {
      const { data: cfg } = await supabase
        .from('app_config').select('value').eq('key', 'feature_limits').maybeSingle();
      const parsed = cfg?.value ? JSON.parse(cfg.value) : {};
      if (Number.isFinite(Number(parsed.qa))) qaLimit = Math.max(0, Math.round(Number(parsed.qa)));
    } catch { /* 설정 조회 실패 시 기본값 */ }

    const { data: usage } = await supabase.rpc('increment_feature_usage', {
      p_user_id: decoded.userId,
      p_date: today,
      p_feature: 'qa',
      p_limit: qaLimit,
    });
    if (usage?.exceeded) {
      return res.status(429).json({ error: `코칭AI는 하루 ${qaLimit}회까지 이용할 수 있습니다. 내일 다시 이용해주세요.` });
    }
  }

  // 1) 하이브리드 검색: 벡터 유사도 + 키워드 정확 일치를 병행해 합친다
  //    (벡터만 쓰면 "상품명"처럼 핵심 단어가 든 청크를 놓치는 경우가 있음)
  const [queryEmbedding] = await embedTexts([question]);
  const [vectorResult, keywordChunks] = await Promise.all([
    supabase.rpc('match_knowledge_chunks', {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      min_similarity: MIN_SIMILARITY,
    }),
    keywordSearch(extractKeywords(question), 4),
  ]);
  if (vectorResult.error) {
    console.error('match_knowledge_chunks error:', vectorResult.error);
    return res.status(500).json({ error: '지식 검색 중 오류가 발생했습니다. (마이그레이션 실행 여부를 확인하세요)' });
  }

  // 키워드 일치 청크를 앞에 두고, 벡터 결과를 뒤에 합친 뒤 중복 제거
  const seenChunks = new Set<string>();
  const chunks: any[] = [...keywordChunks, ...(vectorResult.data || [])]
    .filter((c: any) => (seenChunks.has(c.chunk_id) ? false : (seenChunks.add(c.chunk_id), true)))
    .slice(0, MATCH_COUNT + 2);
  if (chunks.length === 0) {
    const { data: log } = await supabase
      .from('qa_logs')
      .insert({ user_id: decoded.userId, question, answer: NOT_COVERED_ANSWER, sources: [], matched: false, model: 'rule-no-match' })
      .select('id')
      .single();
    return res.status(200).json({
      answer: NOT_COVERED_ANSWER,
      sources: [],
      matched: false,
      logId: log?.id ?? null,
      remaining: (req as any)._remaining,
    });
  }

  // 3) 훈프로 말투 답변 생성
  const context = chunks
    .map((c, i) => `[자료 ${i + 1}] (출처: ${c.doc_title})\n${c.content}`)
    .join('\n\n---\n\n');

  const apiKey = getOpenAiKey();
  if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[강의 자료]\n${context}\n\n[수강생 질문]\n${question}` },
      ],
      temperature: 0.5,
    }),
  });
  const data: any = await openaiRes.json();
  if (!openaiRes.ok) {
    const detail = data?.error?.message || `답변 생성 실패 (HTTP ${openaiRes.status})`;
    console.error('QA OpenAI error:', JSON.stringify(data));
    return res.status(openaiRes.status === 429 ? 429 : 502).json({ error: detail });
  }

  // 모델이 규칙을 어기고 출처 줄을 붙여도 제거
  const answer = data?.choices?.[0]?.message?.content
    ?.replace(/\n?\s*(📚|참고\s*:)[^\n]*/g, '')
    .trim();
  if (!answer) return res.status(502).json({ error: '답변이 비어 있습니다. 다시 시도해주세요.' });

  // 출처 목록 — 답변에는 노출하지 않고 관리자 로그(qa_logs)에만 기록
  const seen = new Set<string>();
  const sources = chunks
    .filter(c => (seen.has(c.doc_id) ? false : (seen.add(c.doc_id), true)))
    .map(c => ({
      docId: c.doc_id,
      title: c.doc_title,
      sourceType: c.source_type,
      similarity: c.similarity == null ? null : Math.round(Number(c.similarity) * 100) / 100,
    }));

  const inputTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
  const outputTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);

  // 로그 (qa_logs + api_calls) — 실패해도 응답은 반환
  let logId: string | null = null;
  try {
    const { data: log } = await supabase
      .from('qa_logs')
      .insert({ user_id: decoded.userId, question, answer, sources, matched: true, model: TEXT_MODEL })
      .select('id')
      .single();
    logId = log?.id ?? null;
    await supabase.from('api_calls').insert({
      user_id: decoded.userId,
      feature: 'qa-ask',
      model: TEXT_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: calcCostUsd(TEXT_MODEL, inputTokens, outputTokens),
    });
  } catch (logErr) {
    console.error('QA log failed:', logErr);
  }

  return res.status(200).json({
    answer,
    matched: true,
    logId,
    remaining: (req as any)._remaining,
  });
}

// ── 수강생: 답변 피드백 (👍=1 / 👎=-1) ──
async function handleFeedback(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { logId, feedback } = req.body ?? {};
  if (!logId || ![1, -1].includes(Number(feedback))) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const { error } = await supabase
    .from('qa_logs')
    .update({ feedback: Number(feedback) })
    .eq('id', logId)
    .eq('user_id', decoded.userId);

  if (error) return res.status(500).json({ error: '피드백 저장에 실패했습니다.' });
  return res.status(200).json({ ok: true });
}

// ── 자료 본문 검증 + 마스킹 + 청크 분할 + 임베딩 (업로드/수정 공용) ──
async function prepareDocContent(rawContent: string, sourceType: string):
  Promise<{ error?: string; content?: string; chunks?: string[]; embeddings?: number[][] }> {
  let content = String(rawContent || '').trim();
  if (content.length < 50) return { error: '자료 내용이 너무 짧습니다. (최소 50자)' };
  if (content.length > MAX_INGEST_CHARS) {
    return { error: `자료가 너무 큽니다. ${MAX_INGEST_CHARS.toLocaleString()}자 이내로 나눠서 업로드해주세요.` };
  }

  // 개인정보 마스킹 (카톡은 수강생 이름까지 마스킹)
  if (sourceType === 'kakao') content = maskKakaoNames(content);
  content = maskSensitiveInfo(content);

  const chunks = chunkText(content);
  if (chunks.length === 0) return { error: '유효한 내용을 추출하지 못했습니다.' };

  const embeddings = await embedTexts(chunks);
  return { content, chunks, embeddings };
}

async function insertChunkRows(docId: string, chunks: string[], embeddings: number[][]): Promise<boolean> {
  const rows = chunks.map((c, i) => ({
    doc_id: docId,
    chunk_index: i,
    content: c,
    embedding: embeddings[i],
  }));
  // 대용량 insert를 나눠서 수행
  const INSERT_BATCH = 50;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase.from('knowledge_chunks').insert(rows.slice(i, i + INSERT_BATCH));
    if (error) {
      console.error('knowledge_chunks insert error:', error);
      return false;
    }
  }
  return true;
}

// ── 관리자: 자료 업로드 (청크 분할 + 임베딩) ──
async function handleIngest(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const title = String(req.body?.title || '').trim();
  const sourceType = req.body?.sourceType === 'kakao' ? 'kakao' : 'lecture';
  if (!title) return res.status(400).json({ error: '자료 제목을 입력해주세요.' });

  const prepared = await prepareDocContent(req.body?.content, sourceType);
  if (prepared.error) return res.status(400).json({ error: prepared.error });
  const { content, chunks, embeddings } = prepared as Required<typeof prepared>;

  const { data: doc, error: docError } = await supabase
    .from('knowledge_docs')
    .insert({
      title,
      source_type: sourceType,
      chunk_count: chunks.length,
      char_count: content.length,
      content,
      created_by: decoded.userId,
    })
    .select('id')
    .single();
  if (docError || !doc) {
    console.error('knowledge_docs insert error:', docError);
    return res.status(500).json({ error: '문서 저장에 실패했습니다. (마이그레이션 실행 여부를 확인하세요)' });
  }

  if (!(await insertChunkRows(doc.id, chunks, embeddings))) {
    await supabase.from('knowledge_docs').delete().eq('id', doc.id); // 청크 저장 실패 시 롤백
    return res.status(500).json({ error: '청크 저장에 실패했습니다.' });
  }

  return res.status(200).json({
    ok: true,
    docId: doc.id,
    chunkCount: chunks.length,
    message: `"${title}" 업로드 완료 (${chunks.length}개 청크)`,
  });
}

// ── 관리자: 자료 원문 조회 (수정 화면용) ──
async function handleDoc(req: VercelRequest, res: VercelResponse) {
  const docId = String(req.query.docId || req.body?.docId || '');
  if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

  const { data, error } = await supabase
    .from('knowledge_docs')
    .select('id, title, source_type, content')
    .eq('id', docId)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
  if (!data.content) {
    return res.status(400).json({ error: '원문이 저장되지 않은 예전 자료입니다. 삭제 후 다시 업로드해주세요. (이후 올린 자료부터 수정 가능)' });
  }
  return res.status(200).json({ doc: data });
}

// ── 관리자: 자료 수정 (원문 교체 → 기존 청크 삭제 → 재청크 + 재임베딩) ──
async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const docId = String(req.body?.docId || '');
  const title = String(req.body?.title || '').trim();
  if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });
  if (!title) return res.status(400).json({ error: '자료 제목을 입력해주세요.' });

  const { data: doc, error: docError } = await supabase
    .from('knowledge_docs')
    .select('id, source_type')
    .eq('id', docId)
    .maybeSingle();
  if (docError || !doc) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });

  const prepared = await prepareDocContent(req.body?.content, doc.source_type);
  if (prepared.error) return res.status(400).json({ error: prepared.error });
  const { content, chunks, embeddings } = prepared as Required<typeof prepared>;

  // 임베딩 성공 후 기존 청크 삭제 → 새 청크 저장
  const { error: delError } = await supabase.from('knowledge_chunks').delete().eq('doc_id', docId);
  if (delError) {
    console.error('knowledge_chunks delete error:', delError);
    return res.status(500).json({ error: '기존 청크 삭제에 실패했습니다. 다시 시도해주세요.' });
  }
  if (!(await insertChunkRows(docId, chunks, embeddings))) {
    return res.status(500).json({ error: '청크 저장에 실패했습니다. [수정 저장]을 다시 눌러주세요.' });
  }

  const { error: updError } = await supabase
    .from('knowledge_docs')
    .update({ title, content, chunk_count: chunks.length, char_count: content.length })
    .eq('id', docId);
  if (updError) {
    console.error('knowledge_docs update error:', updError);
    return res.status(500).json({ error: '문서 정보 갱신에 실패했습니다.' });
  }

  return res.status(200).json({
    ok: true,
    docId,
    chunkCount: chunks.length,
    message: `"${title}" 수정 완료 (${chunks.length}개 청크 재생성)`,
  });
}

// ── 관리자: 자료 목록 ──
async function handleDocs(_req: VercelRequest, res: VercelResponse) {
  const { data, error } = await supabase
    .from('knowledge_docs')
    .select('id, title, source_type, chunk_count, char_count, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('knowledge_docs list error:', error);
    return res.status(500).json({ error: '자료 목록을 불러오지 못했습니다. (마이그레이션 실행 여부를 확인하세요)' });
  }
  return res.status(200).json({ docs: data || [] });
}

// ── 관리자: 자료 삭제 (청크는 FK cascade로 함께 삭제) ──
async function handleDelete(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const docId = String(req.body?.docId || '');
  if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

  const { error } = await supabase.from('knowledge_docs').delete().eq('id', docId);
  if (error) return res.status(500).json({ error: '삭제에 실패했습니다.' });
  return res.status(200).json({ ok: true, message: '자료가 삭제됐습니다.' });
}

// ── 관리자: 질문/답변 로그 ──
async function handleLogs(req: VercelRequest, res: VercelResponse) {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const { data, error } = await supabase
    .from('qa_logs')
    .select('id, question, answer, sources, matched, feedback, model, created_at, users(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('qa_logs list error:', error);
    return res.status(500).json({ error: '로그를 불러오지 못했습니다.' });
  }
  return res.status(200).json({ logs: data || [] });
}
