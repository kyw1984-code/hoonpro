import type { VercelRequest, VercelResponse } from '@vercel/node';
import { HOWTO } from '../src/lib/howto.js';
import { DEFAULT_FEATURE_LIMITS, decideQuota, isDisabled, parseLimits } from '../src/lib/featureLimits.js';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { buildSellerContext } from '../lib/coupang-context.js';
import { calcCostUsd } from '../src/lib/pricing.js';
import { checkAccess } from '../src/lib/accessGate.js';
import { emailFrom } from '../src/lib/emailFrom.js';
import { wrapEmail, emailButton, emailQuote, toHtmlParagraphs } from '../src/lib/emailTemplate.js';

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


// 민감 주제: LLM 호출 없이 직접 문의 유도 (환불/계정정지/세무)
const SENSITIVE_PATTERNS: { pattern: RegExp; topic: string }[] = [
  { pattern: /환불|환급|수강\s*취소|결제\s*취소/, topic: '환불/결제' },
  { pattern: /계정\s*정지|계정\s*제한|어카운트\s*정지|판매\s*정지|영구\s*정지|아이디\s*정지/, topic: '계정 정지' },
  { pattern: /세무|세금\s*신고|종합\s*소득세|부가세|부가가치세|사업자\s*세금|절세/, topic: '세무' },
];


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
  '괜히 부정확한 답변으로 혼란을 드리는 것보다, **이 질문을 훈프로에게 그대로 전달해 두었습니다.** ' +
  '확인 후 직접 답변드리고, 답이 준비되면 메일로 알려드릴게요. 이 화면에서도 다시 보실 수 있습니다.\n\n' +
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
7. 자료에 영어 약칭으로 적힌 일반 단어는 자연스러운 한글 표기로 바꿔 말합니다. (예: '반팔 T' → '반팔 티', 'T셔츠' → '티셔츠') 단, 실제로 영어로 입력해야 하는 설정값(색상 옵션 Black/White 등)과 고유명사·서비스명은 그대로 둡니다.
8. [수강생의 실제 판매 데이터]가 주어지면, 그 숫자는 이 수강생 본인의 확정된 실적입니다. 조언의 근거는 여전히 [강의 자료]에서만 가져오되, 그 조언을 이 수강생의 숫자에 맞춰 구체적으로 말하세요. (예: "이익률이 4.2%시니 이 상태로 광고를 늘리면 팔수록 손해입니다") 데이터에 없는 수치를 지어내지 말고, 데이터가 없으면 있는 척하지 마세요.`;

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
      case 'suggest':
        return await handleSuggest(req, res, decoded);
      case 'suggest-list':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleSuggestList(req, res);
      case 'suggest-update':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleSuggestUpdate(req, res);
      case 'suggest-reply':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handleSuggestReply(req, res, decoded);
      case 'my-suggestions':
        return await handleMySuggestions(res, decoded);
      case 'suggest-mark-seen':
        return await handleSuggestMarkSeen(req, res, decoded);
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
      case 'pending':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        return await handlePending(res);
      case 'answer':
        if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handleAnswer(req, res, decoded);
      case 'my-answers':
        return await handleMyAnswers(res, decoded);
      case 'mark-seen':
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handleMarkSeen(req, res, decoded);
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


  // 접근 게이트 — 아직 우리 회원인가, 유료화가 켜졌다면 구독이 있는가.
  // 판정은 src/lib/accessGate.ts 한 곳에 있다. 예전에는 이 검사가 파일
  // 여섯 곳에 복사돼 있었고, 회원 상태는 아예 보지 않아 탈퇴·거절된
  // 사람이 토큰이 만료되는 7일까지 계속 쓸 수 있었다.
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

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
    let qaLimit = DEFAULT_FEATURE_LIMITS.qa;
    try {
      const { data: cfg } = await supabase
        .from('app_config').select('value').eq('key', 'feature_limits').maybeSingle();
      qaLimit = parseLimits(cfg?.value).qa;
    } catch { /* 설정 조회 실패 시 기본값 */ }

    // 예전에는 error를 아예 안 봤다. rpc가 실패하면 usage가 null이 되고
    // `usage?.exceeded`는 false라 그냥 통과했다. 한도가 통째로 풀린 셈이다.
    const rpc = await supabase.rpc('increment_feature_usage', {
      p_user_id: decoded.userId,
      p_date: today,
      p_feature: 'qa',
      p_limit: qaLimit,
    });
    const d = decideQuota(qaLimit, rpc);
    if (!d.allow) {
      // 한도 0은 '오늘 다 썼다'가 아니라 '내린 기능'이다
      if (d.kind === 'disabled') {
        return res.status(403).json({ error: '코칭AI는 현재 제공하지 않습니다.', disabled: true });
      }
      if (d.kind === 'error') {
        console.error('[한도] qa 집계 실패', { userId: decoded.userId, rpcError: String((rpc as any)?.error?.message ?? '') });
        return res.status(503).json({ error: '사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', retryable: true });
      }
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

  // 쿠팡을 연동한 수강생이면 본인 실적을 함께 넘긴다. 같은 질문이라도
  // 이익률 3%인 사람과 22%인 사람에게 답이 달라야 하기 때문이다.
  const sellerContext = await buildSellerContext(decoded.userId);
  const sellerBlock = sellerContext ? `\n\n[수강생의 실제 판매 데이터]\n${sellerContext}` : '';

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[강의 자료]\n${context}${sellerBlock}\n\n[수강생 질문]\n${question}` },
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

// ═══════════════════════════════════════════════════════════════
// 답 못 한 질문 → 운영자가 직접 답 → 질문자에게 전달
//
// 코칭AI가 모르는 질문은 지금까지 "단톡방에 물어보세요"로 끝났다. 질문은
// 로그에만 남고 아무도 다시 보지 않았다. 정작 단톡방에서 질문을 어려워하는
// 분들 때문에 만든 기능인데, 막히면 결국 같은 자리로 돌려보낸 셈이다.
//
// 이제 그 질문이 관리자 화면에 쌓이고, 운영자가 답을 달면 질문자에게 메일과
// 앱 알림으로 간다.
// ═══════════════════════════════════════════════════════════════

/** 관리자: 아직 답이 안 달린 질문들 */
async function handlePending(res: VercelResponse) {
  const { data, error } = await supabase
    .from('qa_logs')
    .select('id, question, answer, model, created_at, users(name, email)')
    .eq('matched', false)
    .is('admin_answer', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('qa pending error:', error);
    return res.status(500).json({ error: '미답변 목록을 불러오지 못했습니다.' });
  }
  return res.status(200).json({ pending: data ?? [], count: (data ?? []).length });
}

/**
 * 관리자가 답을 단다. 저장이 먼저, 메일은 그 다음이다.
 *
 * 메일이 실패해도 답변은 남아야 한다 — 질문자가 앱에 들어오면 볼 수 있고,
 * 관리자도 '보냈는데 안 갔다'를 알 수 있다. 반대로 하면 메일 한 번 실패에
 * 애써 쓴 답이 사라진다.
 */
async function handleAnswer(req: VercelRequest, res: VercelResponse, decoded: any) {
  const id = String(req.body?.id ?? '').trim();
  const answer = String(req.body?.answer ?? '').trim();
  if (!id) return res.status(400).json({ error: '어느 질문인지 지정해주세요.' });
  if (answer.length < 2) return res.status(400).json({ error: '답변 내용을 입력해주세요.' });
  if (answer.length > 5000) return res.status(400).json({ error: '답변이 너무 깁니다. (5,000자 이하)' });

  const { data: log } = await supabase
    .from('qa_logs')
    .select('id, question, user_id, admin_answer, users(name, email)')
    .eq('id', id)
    .maybeSingle();
  if (!log) return res.status(404).json({ error: '질문을 찾을 수 없습니다.' });

  const { error } = await supabase.from('qa_logs').update({
    admin_answer: answer,
    answered_at: new Date().toISOString(),
    answered_by: decoded.userId,
    // 고쳐 쓴 답이면 질문자가 다시 보도록 확인 표시를 지운다
    seen_at: null,
  }).eq('id', id);
  if (error) return res.status(500).json({ error: '답변을 저장하지 못했습니다.' });

  // 메일. 회원이 탈퇴했거나 주소가 없으면 앱 알림만 남는다.
  const to = (log as any).users?.email ?? '';
  const name = (log as any).users?.name ?? '';
  let mailed = false;
  if (to && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: emailFrom(),
          to: [to],
          subject: '[훈프로] 문의하신 내용에 답변드립니다',
          html: wrapEmail(
            '훈프로가 직접 답변드립니다',
            `<p>${name ? name + '님, ' : ''}코칭AI가 답을 드리지 못했던 질문에 직접 답변드립니다.</p>` +
            `<p style="color:#8a92a6;font-size:12.5px;margin-bottom:2px;">보내주신 질문</p>` +
            emailQuote(log.question) +
            `<p style="color:#8a92a6;font-size:12.5px;margin-bottom:2px;">답변</p>` +
            `<div style="color:#e8ecf5;">${toHtmlParagraphs(answer)}</div>` +
            emailButton('훈프로 코칭AI 열기'),
            '이 답변은 훈프로 코칭AI에서도 다시 보실 수 있습니다.',
          ),
        }),
      });
      mailed = r.ok;
      if (r.ok) await supabase.from('qa_logs').update({ mail_sent_at: new Date().toISOString() }).eq('id', id);
    } catch { /* 메일 실패가 답변 저장을 되돌리지 않는다 */ }
  }

  return res.status(200).json({ ok: true, mailed, to: to ? true : false });
}

/** 질문자: 내 질문에 달린 운영자 답변 중 아직 안 본 것 */
async function handleMyAnswers(res: VercelResponse, decoded: any) {
  const { data, error } = await supabase
    .from('qa_logs')
    .select('id, question, admin_answer, answered_at, seen_at')
    .eq('user_id', decoded.userId)
    .not('admin_answer', 'is', null)
    .order('answered_at', { ascending: false })
    .limit(20);
  if (error) return res.status(200).json({ answers: [], unseen: 0 });

  const answers = data ?? [];
  return res.status(200).json({
    answers,
    unseen: answers.filter((a: any) => !a.seen_at).length,
  });
}

/** 질문자가 확인했다. 확인한 뒤로는 알림을 띄우지 않는다 */
async function handleMarkSeen(req: VercelRequest, res: VercelResponse, decoded: any) {
  const id = String(req.body?.id ?? '').trim();
  let q = supabase.from('qa_logs').update({ seen_at: new Date().toISOString() })
    .eq('user_id', decoded.userId)
    .not('admin_answer', 'is', null)
    .is('seen_at', null);
  // id를 주면 그것만, 안 주면 전부 (화면에서 한 번에 닫을 때)
  if (id) q = q.eq('id', id);
  await q;
  return res.status(200).json({ ok: true });
}

// ═══════════════════════════════════════════════════════════════
// 건의에 직접 답하기
//
// 건의를 [처리함]으로 바꿔도 적은 사람은 아무것도 못 받았다. 자기 건의가
// 어떻게 됐는지 알 방법이 아예 없었다 — 앱에 '내 건의' 목록도 없다.
//
// 그렇다고 [처리함]에 자동 문구를 붙이지는 않는다. 두 가지 이유다.
//   · 같은 얘기를 여러 명이 하면 묶어서 한 번에 처리하는데, 그때 내용 없는
//     '처리됐습니다'가 열 명에게 한꺼번에 날아간다.
//   · '처리함'이 실제로는 '확인했고 안 고치기로 함'일 때가 있다. 그걸 그대로
//     보내면 오해가 생긴다.
//
// 그래서 운영자가 한 줄 적어 보낼 때만 나간다. 묶음으로 보내면 그 묶음에 든
// 사람 전부에게 같은 답이 가되, 메일에는 각자가 적은 원문을 실어 준다 —
// 무엇에 대한 답인지 모르면 답이 아니다.
// ═══════════════════════════════════════════════════════════════

/** 한 번에 답할 수 있는 건의 수. 메일을 그만큼 보내므로 함수 시간 안에 둔다 */
const REPLY_BATCH_MAX = 30;

async function handleSuggestReply(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const reply = String(req.body?.reply ?? '').trim();
  if (reply.length < 2) return res.status(400).json({ error: '답변 내용을 입력해주세요.' });
  if (reply.length > 5000) return res.status(400).json({ error: '답변이 너무 깁니다. (5,000자 이하)' });

  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id];
  const ids = [...new Set(raw.map((v: unknown) => String(v ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return res.status(400).json({ error: '어느 건의인지 지정해주세요.' });
  if (ids.length > REPLY_BATCH_MAX) {
    return res.status(400).json({ error: `한 번에 ${REPLY_BATCH_MAX}건까지 보낼 수 있습니다.` });
  }

  const { data: rows, error: readErr } = await supabase
    .from('feedback')
    .select('id, body, user_id, users(name, email)')
    .in('id', ids);
  if (readErr) return res.status(500).json({ error: '건의를 불러오지 못했습니다.' });
  if (!rows || rows.length === 0) return res.status(404).json({ error: '건의를 찾을 수 없습니다.' });

  // 저장이 먼저, 메일이 나중이다. 메일 한 번 실패에 애써 쓴 답이 사라지면 안 된다.
  const patch: Record<string, any> = {
    admin_reply: reply,
    replied_at: new Date().toISOString(),
    replied_by: decoded.userId,
    // 고쳐 쓴 답이면 확인 표시를 지워 다시 보게 한다
    reply_seen_at: null,
    updated_at: new Date().toISOString(),
  };
  // 답을 보내면 그 건의는 처리된 것으로 본다. 상태를 따로 또 누르게 하면
  // 답은 갔는데 목록에는 미처리로 남는 일이 생긴다.
  if (req.body?.markDone !== false) patch.status = 'done';

  const { error: upErr } = await supabase.from('feedback').update(patch).in('id', ids);
  if (upErr) return res.status(500).json({ error: '답변을 저장하지 못했습니다.' });

  // 메일. 탈퇴했거나 주소가 없는 분은 앱 알림으로만 간다 — 화면에 그렇게 밝힌다.
  let mailed = 0;
  let noEmail = 0;
  for (const row of rows as any[]) {
    const to = row.users?.email ?? '';
    const name = row.users?.name ?? '';
    if (!to) { noEmail++; continue; }
    if (!process.env.RESEND_API_KEY) { noEmail++; continue; }
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: emailFrom(),
          to: [to],
          subject: '[훈프로] 보내주신 건의에 답변드립니다',
          html: wrapEmail(
            '보내주신 건의에 답변드립니다',
            `<p>${name ? name + '님, ' : ''}건의해 주셔서 감사합니다.</p>` +
            `<p style="color:#8a92a6;font-size:12.5px;margin-bottom:2px;">보내주신 내용</p>` +
            emailQuote(row.body ?? '') +
            `<p style="color:#8a92a6;font-size:12.5px;margin-bottom:2px;">답변</p>` +
            `<div style="color:#e8ecf5;">${toHtmlParagraphs(reply)}</div>` +
            emailButton('훈프로 열기'),
            '이 답변은 훈프로 [건의하기]에서도 다시 보실 수 있습니다.',
          ),
        }),
      });
      if (r.ok) {
        mailed++;
        await supabase.from('feedback')
          .update({ reply_mail_sent_at: new Date().toISOString() }).eq('id', row.id);
      } else {
        noEmail++;
      }
    } catch {
      // 메일 실패가 답변 저장을 되돌리지 않는다. 대신 몇 건이 못 갔는지 알린다.
      noEmail++;
    }
  }

  return res.status(200).json({ ok: true, updated: rows.length, mailed, noEmail });
}

/** 건의한 사람: 내 건의에 달린 답변 */
async function handleMySuggestions(res: VercelResponse, decoded: any) {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, body, area, admin_reply, replied_at, reply_seen_at')
    .eq('user_id', decoded.userId)
    .not('admin_reply', 'is', null)
    .order('replied_at', { ascending: false })
    .limit(20);
  // 답변 조회가 실패해도 건의 자체는 계속 쓸 수 있어야 한다
  if (error) return res.status(200).json({ replies: [], unseen: 0 });

  const replies = data ?? [];
  return res.status(200).json({
    replies,
    unseen: replies.filter((r: any) => !r.reply_seen_at).length,
  });
}

/** 건의한 사람이 확인했다. 확인한 뒤로는 알림을 띄우지 않는다 */
async function handleSuggestMarkSeen(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.body?.id ?? '').trim();
  let q = supabase.from('feedback').update({ reply_seen_at: new Date().toISOString() })
    .eq('user_id', decoded.userId)
    .not('admin_reply', 'is', null)
    .is('reply_seen_at', null);
  // id를 주면 그것만, 안 주면 전부 (창을 열어 다 읽었을 때)
  if (id) q = q.eq('id', id);
  await q;
  return res.status(200).json({ ok: true });
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

// ═══════════════════════════════════════════════════════════════
// 건의·문의 창구
//
// 소통 창구가 아예 없었다. 전화나 카카오 상담은 받는 순간 응답 시간이
// 기대치가 되고, 그게 곧 제품 만들 시간을 먹는다. 대신 글로 받는다.
//
// 들어온 글은 유형을 나눈다. "엑셀로 못 내려받나요"는 이미 되는 일이므로
// 그 자리에서 답하고 끝낸다. 그게 운영자에게까지 오면 낭비다. 운영자는
// 진짜 건의만 본다.
//
// 답을 지어내지 않는 것이 이 기능의 전부다. 없는 기능을 있다고 하면
// 구독자는 그걸 찾아 헤매다 신뢰를 잃는다. 확실할 때만 답하고, 아니면
// "전달했습니다"로 끝낸다.
// ═══════════════════════════════════════════════════════════════

/** 한 사람이 하루에 보낼 수 있는 건의 수 — 같은 사람이 수십 건을 쏟아내면 목록이 못 쓰게 된다 */
const SUGGEST_DAILY_MAX = 10;
const SUGGEST_MAX_LEN = 2000;

/** 분류 결과 */
interface Triage {
  kind: 'bug' | 'improve' | 'howto' | 'praise' | 'other';
  summary: string;
  severity: 'high' | 'normal' | 'low';
  /** 이미 되는 일이라 그 자리에서 답할 수 있으면 그 답. 아니면 null */
  reply: string | null;
}

/**
 * 화면별 사용 방법을 분류 근거로 쓴다.
 *
 * 구독자가 읽는 안내와 AI가 답하는 근거가 같아야 한다. 따로 쓰면 둘이
 * 어긋나고, 어긋나면 화면에 적힌 것과 다른 답이 나간다.
 */
function howtoContext(): string {
  return Object.entries(HOWTO)
    .map(([id, g]) => {
      const steps = g.steps.map(s => `- ${s.title}: ${s.desc}`).join('\n');
      return `## ${g.title} (${id})\n${g.lead}\n${steps}${g.caution ? `\n주의: ${g.caution}` : ''}`;
    })
    .join('\n\n');
}

const TRIAGE_PROMPT = `당신은 쿠팡 셀러용 SaaS '훈프로'의 고객 의견을 분류합니다.

[제품이 지금 할 수 있는 일]
{{HOWTO}}

[분류 규칙]
kind는 다음 중 하나입니다.
- howto: 이미 되는 일인데 쓰는 법을 몰라서 물은 것
- bug: 되어야 하는데 안 된다고 말한 것
- improve: 새 기능이나 개선 요청
- praise: 칭찬이나 감사
- other: 위 어디에도 안 맞는 것

severity는 영향 범위로 정합니다.
- high: 결제 실패, 데이터 손실, 로그인 불가, 숫자가 틀림처럼 돈이나 신뢰에 직접 닿는 것
- normal: 기능이 불편하거나 일부가 안 되는 것
- low: 사소한 표기, 취향, 칭찬

summary는 같은 얘기끼리 묶기 위한 한 줄입니다. 12자 안팎의 명사구로 쓰세요.
예: "재고 알림 과다", "엑셀 내보내기 요청", "순위 확인 느림"

reply는 kind가 howto이고 위 [제품이 지금 할 수 있는 일]에 답이 분명히 있을 때만 씁니다.
- 어느 화면의 무엇을 누르면 되는지 구체적으로 쓰세요.
- 자료에 없으면 반드시 null로 두세요. 추측해서 답하지 마세요.
- 없는 기능을 있다고 하면 사용자가 찾아 헤매다 신뢰를 잃습니다.
- 2~3문장, 존댓말.

JSON만 출력하세요:
{"kind":"...","summary":"...","severity":"...","reply":"..." 또는 null}`;

/** 분류에 실패해도 접수는 된다. 분류는 나중에 사람이 할 수 있지만 글을 잃으면 끝이다 */
const TRIAGE_FALLBACK: Triage = { kind: 'other', summary: '', severity: 'normal', reply: null };

async function triageSuggestion(body: string, area: string): Promise<Triage> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return TRIAGE_FALLBACK;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: 'system', content: TRIAGE_PROMPT.replace('{{HOWTO}}', howtoContext()) },
          { role: 'user', content: `[화면] ${area || '(모름)'}\n[내용]\n${body}` },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data: any = await res.json();
    if (!res.ok) return TRIAGE_FALLBACK;

    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    const kinds = ['bug', 'improve', 'howto', 'praise', 'other'];
    const sevs = ['high', 'normal', 'low'];
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';

    return {
      kind: kinds.includes(parsed.kind) ? parsed.kind : 'other',
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 60) : '',
      severity: sevs.includes(parsed.severity) ? parsed.severity : 'normal',
      // howto가 아닌데 답을 단 경우는 버린다. 버그나 요청에 "이렇게 하세요"라고
      // 답하면 고쳐 달라는 사람에게 우회로를 안내하는 꼴이 된다.
      reply: parsed.kind === 'howto' && reply.length > 0 ? reply.slice(0, 600) : null,
    };
  } catch {
    return TRIAGE_FALLBACK;
  }
}

async function handleSuggest(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = String(req.body?.body ?? '').trim();
  const area = String(req.body?.area ?? '').trim().slice(0, 40);
  if (body.length < 5) return res.status(400).json({ error: '조금만 더 자세히 적어주세요.' });
  if (body.length > SUGGEST_MAX_LEN) {
    return res.status(400).json({ error: `${SUGGEST_MAX_LEN}자 안으로 적어주세요.` });
  }

  // 같은 사람이 하루에 수십 건을 쏟아내면 목록이 못 쓰게 된다
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count, error: countError } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', decoded.userId)
    .gte('created_at', since);
  // 셀 수 없으면 받지 않는다. 예전에는 error를 버려서, 조회가 실패하면
  // count가 null이 되고 (null ?? 0) >= 10이 false라 그냥 통과했다. 한 건마다
  // 분류용 AI 호출이 한 번씩 나가므로 상한이 풀리면 그대로 비용이 된다.
  if (countError) {
    console.error('[건의] 일일 건수 조회 실패', { userId: decoded.userId, detail: countError.message });
    return res.status(503).json({ error: '잠시 후 다시 보내주세요.', retryable: true });
  }
  if ((count ?? 0) >= SUGGEST_DAILY_MAX) {
    return res.status(429).json({ error: '오늘 보낼 수 있는 의견을 다 쓰셨습니다. 내일 다시 보내주세요.' });
  }

  const triage = await triageSuggestion(body, area);

  const { error } = await supabase.from('feedback').insert({
    user_id: decoded.userId,
    area: area || null,
    body,
    kind: triage.kind,
    summary: triage.summary || null,
    severity: triage.severity,
    auto_reply: triage.reply,
    answered: triage.reply !== null,
  });
  if (error) return res.status(500).json({ error: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.' });

  return res.status(200).json({
    ok: true,
    // 답을 지어내지 않는다. 확실할 때만 답하고 아니면 전달했다고만 말한다.
    reply: triage.reply,
    kind: triage.kind,
  });
}

/** 관리자 — 같은 얘기끼리 묶어 무엇을 고칠지 보여준다 */
async function handleSuggestList(req: VercelRequest, res: VercelResponse) {
  const status = String(req.query.status ?? 'open');
  let q = supabase
    .from('feedback')
    .select('id, user_id, area, body, kind, summary, severity, auto_reply, answered, status, note, created_at, admin_reply, replied_at, reply_mail_sent_at, users(email, name)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: '불러오지 못했습니다.' });

  const rows = (data ?? []).map((r: any) => ({
    id: String(r.id),
    area: r.area,
    body: r.body,
    kind: r.kind,
    summary: r.summary,
    severity: r.severity,
    autoReply: r.auto_reply,
    answered: r.answered,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
    userId: r.user_id ? String(r.user_id) : null,
    userEmail: r.users?.email ?? null,
    userName: r.users?.name ?? null,
    // 이미 답을 보낸 건의는 화면에서 그렇게 보여야 한다. 안 그러면 같은 사람에게
    // 두 번 보내고, 보낸 줄 모르고 또 쓴다.
    adminReply: r.admin_reply ?? null,
    repliedAt: r.replied_at ?? null,
    // 메일이 실제로 나갔나. 안 나갔으면 앱 알림으로만 갔다는 뜻이다.
    replyMailed: Boolean(r.reply_mail_sent_at),
  }));

  // 같은 요약끼리 묶는다. 한 사람이 한 말과 열 사람이 한 말은 무게가 다르다.
  const groups = new Map<string, {
    summary: string; kind: string; severity: string; count: number; ids: string[];
    people: Set<string>; names: string[];
  }>();
  for (const r of rows) {
    if (!r.summary || r.kind === 'howto' || r.kind === 'praise') continue;
    const key = r.summary;
    const g = groups.get(key)
      ?? { summary: key, kind: r.kind, severity: r.severity, count: 0, ids: [], people: new Set<string>(), names: [] };
    g.count++;
    g.ids.push(r.id);
    // 몇 건인지와 몇 사람인지는 다르다. 한 사람이 세 번 적은 것과 세 사람이
    // 한 번씩 적은 것은 무게가 다른데, 건수만 세면 둘이 똑같아 보인다.
    const who = r.userId ?? r.userEmail ?? '';
    if (who && !g.people.has(who)) {
      g.people.add(who);
      if (g.names.length < 5) g.names.push(r.userName ?? r.userEmail ?? '이름 없음');
    }
    // 한 건이라도 급하면 그 묶음이 급한 것이다
    if (r.severity === 'high') g.severity = 'high';
    groups.set(key, g);
  }

  return res.status(200).json({
    items: rows,
    // 여러 사람이 같은 말을 한 것부터
    groups: [...groups.values()]
      .map(g => ({ summary: g.summary, kind: g.kind, severity: g.severity, count: g.count, ids: g.ids, people: g.people.size, names: g.names }))
      .sort((a, b) => b.people - a.people || b.count - a.count || (a.severity === 'high' ? -1 : 1)),
    counts: {
      open: rows.filter(r => r.status === 'open').length,
      bug: rows.filter(r => r.kind === 'bug').length,
      improve: rows.filter(r => r.kind === 'improve').length,
      howto: rows.filter(r => r.kind === 'howto').length,
    },
  });
}

async function handleSuggestUpdate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.body?.id ?? '');
  if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const status = String(req.body?.status ?? '');
  if (['open', 'planned', 'done', 'wontfix'].includes(status)) patch.status = status;
  if (typeof req.body?.note === 'string') patch.note = req.body.note.slice(0, 500);
  // 여러 건을 한꺼번에 처리한다 — 같은 얘기를 열 명이 했으면 열 번 누를 이유가 없다
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [id];

  const { error } = await supabase.from('feedback').update(patch).in('id', ids);
  if (error) return res.status(500).json({ error: '저장하지 못했습니다.' });
  return res.status(200).json({ ok: true, updated: ids.length });
}
