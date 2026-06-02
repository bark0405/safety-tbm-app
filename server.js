import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 5173);
const openAiKey = cleanApiKey(process.env.OPENAI_API_KEY);
const detectedGeminiKey =
  cleanApiKey(process.env.GEMINI_API_KEY) ||
  cleanApiKey(process.env.GOOGLE_API_KEY) ||
  (/^AIza/.test(openAiKey) ? openAiKey : '');
const provider =
  normalizeProvider(process.env.AI_PROVIDER) ||
  (detectedGeminiKey ? 'gemini' : 'openai');
const model =
  provider === 'gemini'
    ? process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.5-flash'
    : process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-5.4-mini';
const safetyNotice =
  '본 앱은 작업 전 위험성 인식과 TBM 보조용입니다. 최종 작업 허가와 안전 판단은 현장 SOP, 법규, 작업허가 승인권자 기준을 우선해야 합니다.';
const stopCriteriaKeys = [
  'smellLeak',
  'residualPressure',
  'gasAlarm',
  'scopeChange',
  'lotoUnclear',
  'simultaneousInterference',
];

app.use(express.json({ limit: '2mb' }));
app.use((error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: '요청 JSON 형식이 올바르지 않습니다.' });
    return;
  }

  next(error);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider,
    model,
    hasApiKey: hasProviderKey(),
    hasOpenAIKey: Boolean(openAiKey),
    hasGeminiKey: Boolean(detectedGeminiKey),
  });
});

app.post('/api/tbm-briefing', async (req, res) => {
  if (!hasProviderKey()) {
    res.status(503).json({
      error: getMissingKeyMessage(),
    });
    return;
  }

  const payload = req.body;
  if (!Array.isArray(payload?.permits) || payload.permits.length === 0) {
    res.status(400).json({ error: '분석할 작업허가서 데이터가 없습니다.' });
    return;
  }

  try {
    const outputText =
      provider === 'gemini'
        ? await generateGeminiText(payload)
        : await generateOpenAiText(payload);
    const parsed = parseJsonResponse(outputText || '');
    const result = normalizeAiResult(parsed, payload);
    res.json({ result, model, provider });
  } catch (error) {
    const message =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 브리핑 생성 중 알 수 없는 오류가 발생했습니다.';
    res.status(500).json({ error: message });
  }
});

const distDir = resolve(__dirname, 'dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(join(distDir, 'index.html'));
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Permit-to-TBM Copilot server: http://127.0.0.1:${port}`);
  console.log(`AI provider: ${provider}`);
  console.log(`AI model: ${model}`);
});

function getSystemInstructions() {
  return [
    '너는 석유화학 공장 아침 TBM을 돕는 한국어 안전 브리핑 작성자다.',
    '입력된 작업허가서, Rule-based Risk Score, Risk Level, 위험유형을 사실로 취급하고 점수를 바꾸지 않는다.',
    '현장 Foreman이 5분 안에 읽을 수 있도록 구체적이고 짧은 지시문으로 쓴다.',
    '새로운 작업허가서, 없는 설비명, 없는 물질명, 없는 작업자를 상상해서 추가하지 않는다.',
    '최종 판단은 SOP, 법규, 작업허가 승인권자 기준을 우선한다는 안전 문구를 존중한다.',
    '응답은 설명 없이 JSON 객체만 반환한다.',
  ].join('\n');
}

async function generateOpenAiText(payload) {
  const client = new OpenAI({ apiKey: openAiKey });
  const response = await client.responses.create({
    model,
    instructions: getSystemInstructions(),
    input: buildPrompt(payload),
  });

  return response.output_text || '';
}

async function generateGeminiText(payload) {
  const geminiModel = model.startsWith('models/') ? model : `models/${model}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': detectedGeminiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: getSystemInstructions() }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(payload) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Gemini API 호출 실패: HTTP ${response.status}`
    );
  }

  const outputText = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();

  if (!outputText) {
    throw new Error(
      data.candidates?.[0]?.finishReason
        ? `Gemini 응답에 텍스트가 없습니다. finishReason=${data.candidates[0].finishReason}`
        : 'Gemini 응답에 텍스트가 없습니다.'
    );
  }

  return outputText;
}

function buildPrompt(payload) {
  const safePayload = {
    permits: payload.permits.map((permit) => ({
      permitNo: permit.permitNo,
      area: permit.area,
      equipment: permit.equipment,
      jobType: permit.jobType,
      description: permit.description,
      contractor: permit.contractor,
      startTime: permit.startTime,
      endTime: permit.endTime,
      material: permit.material,
      hazard: permit.hazard,
      permitType: permit.permitType,
      riskScore: permit.riskScore,
      riskLevel: permit.riskLevel?.label || permit.riskLevel,
      riskReasons: permit.riskReasons,
      hazardTypes: permit.hazardTypes,
    })),
    areaStats: payload.areaStats,
    hazardStats: payload.hazardStats,
    highJobs: payload.highJobs,
    baseline: payload.baseline,
    requiredSafetyNotice: safetyNotice,
  };

  return `다음 작업허가서 분석 결과를 바탕으로 오늘 아침 Foreman용 TBM 브리핑을 생성하라.

반환 JSON 스키마:
{
  "overview": {
    "totalCount": 0,
    "highCount": 0,
    "mediumCount": 0,
    "lowCount": 0,
    "topHazardTypes": ["가장 주의할 위험유형 Top 3"]
  },
  "highRiskTop5": [
    {
      "permitNo": "입력된 permitNo",
      "area": "입력된 area",
      "jobName": "구체 작업명",
      "hazardTypes": ["위험유형"],
      "whyDangerous": "왜 위험한지",
      "foremanQuestion": "Foreman 확인 질문",
      "stopCriteria": "해당 작업의 작업중지 기준"
    }
  ],
  "tbmBriefing": "Foreman이 그대로 읽을 수 있는 5분 TBM 브리핑",
  "stopCriteria": {
    "smellLeak": "냄새/누출 기준",
    "residualPressure": "압력 잔류 기준",
    "gasAlarm": "Gas Alarm 기준",
    "scopeChange": "작업범위 변경 기준",
    "lotoUnclear": "LOTO 불확실 기준",
    "simultaneousInterference": "동시작업 간섭 기준"
  },
  "safetyResponsibilityNotice": "${safetyNotice}"
}

작성 기준:
- highRiskTop5는 입력 highJobs의 상위 5개만 사용하고 순서를 바꾸지 않는다.
- 각 highRiskTop5 항목은 Permit No, Area, 작업명, 위험유형, 왜 위험한지, Foreman 확인 질문, 작업중지 기준을 모두 채운다.
- tbmBriefing에는 "안전 유의", "주의 철저", "조심" 같은 추상 표현을 쓰지 않는다.
- tbmBriefing에는 반드시 오늘 작업허가서의 구체 작업명, Area, 위험유형, 다칠 수 있는 방식을 포함한다.
- stopCriteria는 반드시 smellLeak, residualPressure, gasAlarm, scopeChange, lotoUnclear, simultaneousInterference 6개 키를 모두 채운다.
- ${safetyNotice}

입력 데이터:
${JSON.stringify(safePayload, null, 2)}`;
}

function parseJsonResponse(text) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(withoutFence);
}

function normalizeAiResult(result, payload) {
  const permits = payload.permits;
  const highJobs = (payload.highJobs || []).slice(0, 5);
  const levelCounts = permits.reduce(
    (acc, permit) => {
      const label = permit.riskLevel?.label || permit.riskLevel || 'Low';
      if (label === 'High') acc.highCount += 1;
      else if (label === 'Medium') acc.mediumCount += 1;
      else acc.lowCount += 1;
      return acc;
    },
    { highCount: 0, mediumCount: 0, lowCount: 0 }
  );

  const aiTopItems = Array.isArray(result.highRiskTop5) ? result.highRiskTop5 : [];
  const highRiskTop5 = highJobs.map((job) => {
    const aiItem =
      aiTopItems.find((item) => String(item?.permitNo || '') === job.permitNo) || {};

    return {
      permitNo: job.permitNo,
      area: job.area || '',
      jobName: job.equipment || job.description || job.jobType || '',
      hazardTypes: ensureStringArray(aiItem.hazardTypes).length
        ? ensureStringArray(aiItem.hazardTypes)
        : ensureStringArray(job.hazardTypes),
      whyDangerous:
        ensureString(aiItem.whyDangerous) ||
        `${ensureStringArray(job.riskReasons).join(', ') || '작업 조건 변화 시 위험이 커질 수 있음'}`,
      foremanQuestion:
        ensureString(aiItem.foremanQuestion) ||
        `${job.area} ${job.equipment || job.jobType} 작업의 차단, 잔압, 대피 방향을 누가 확인했습니까?`,
      stopCriteria:
        ensureString(aiItem.stopCriteria) ||
        `${job.area} ${job.equipment || job.jobType} 작업 조건이 허가서와 다르면 작업을 중지한다.`,
    };
  });

  return {
    overview: {
      totalCount: permits.length,
      ...levelCounts,
      topHazardTypes: normalizeTopHazards(result.overview?.topHazardTypes, payload),
    },
    highRiskTop5,
    tbmBriefing:
      ensureString(result.tbmBriefing) ||
      ensureString(result.briefing) ||
      'AI 브리핑 본문이 생성되지 않았습니다.',
    stopCriteria: normalizeStopCriteria(result.stopCriteria),
    safetyResponsibilityNotice:
      ensureString(result.safetyResponsibilityNotice) || safetyNotice,
    generatedAt: new Date().toISOString(),
  };
}

function ensureStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function ensureString(value) {
  return String(value || '').trim();
}

function normalizeProvider(value) {
  const providerName = String(value || '').trim().toLowerCase();
  if (providerName === 'gemini' || providerName === 'google') return 'gemini';
  if (providerName === 'openai') return 'openai';
  return '';
}

function hasProviderKey() {
  if (provider === 'gemini') return Boolean(detectedGeminiKey);
  return Boolean(openAiKey);
}

function getMissingKeyMessage() {
  if (provider === 'gemini') {
    return 'GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되어 있지 않습니다. .env 파일에 Gemini 키를 넣고 서버를 다시 시작하세요.';
  }

  return 'OPENAI_API_KEY가 설정되어 있지 않습니다. .env 파일에 키를 넣고 서버를 다시 시작하세요.';
}

function cleanApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (/^your_/i.test(key)) return '';
  if (/api key/i.test(key)) return '';
  return key;
}

function normalizeTopHazards(value, payload) {
  const provided = ensureStringArray(value).slice(0, 3);
  if (provided.length === 3) return provided;

  const fallback = (payload.hazardStats || [])
    .filter((hazard) => hazard.count > 0)
    .slice(0, 3)
    .map((hazard) => `${hazard.name} ${hazard.count}건`);

  return [...provided, ...fallback].slice(0, 3);
}

function normalizeStopCriteria(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = {
    smellLeak: '냄새가 나거나 Drain, Vent, Flange 주변에서 액체 또는 가스 누출이 보이면 작업을 중지한다.',
    residualPressure: '압력계, 드레인, 벤트로 잔압 제거가 확인되지 않으면 개방 작업을 시작하지 않는다.',
    gasAlarm: '휴대용 또는 고정식 Gas Alarm이 울리거나 측정값이 기준 밖이면 즉시 대피하고 재측정한다.',
    scopeChange: '작업위치, 설비, 방법, 인원, 시간이 허가서와 달라지면 작업허가를 재확인한다.',
    lotoUnclear: 'LOTO 표식, 무전압 확인, 차단 밸브 상태 중 하나라도 불확실하면 작업을 중지한다.',
    simultaneousInterference: '화기, 인양, 개방, 고소 작업 반경이 겹치는데 통제선과 신호수가 없으면 작업을 중지한다.',
  };

  return stopCriteriaKeys.reduce((acc, key) => {
    acc[key] = ensureString(source[key]) || fallback[key];
    return acc;
  }, {});
}
