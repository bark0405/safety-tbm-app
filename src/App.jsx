import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import {
  AlertTriangle,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Flame,
  Gauge,
  HelpCircle,
  Map,
  ShieldCheck,
  Upload,
} from 'lucide-react';

const REQUIRED_NOTICE =
  '본 앱은 작업 전 위험성 인식과 TBM 보조용입니다. 최종 작업 허가와 안전 판단은 현장 SOP, 법규, 작업허가 승인권자 기준을 우선해야 합니다.';

const FIELD_LABELS = {
  permitNo: '허가번호',
  area: 'Area/Unit',
  equipment: '설비',
  jobType: '작업유형',
  description: '작업내용',
  contractor: '업체',
  startTime: '시작',
  endTime: '종료',
  material: '물질',
  hazard: '위험요소',
  permitType: '허가유형',
};

const RISK_RULES = [
  { label: '밀폐공간', score: 5, keywords: ['confined space', '밀폐공간'] },
  { label: '화기작업', score: 5, keywords: ['hot work', '화기'] },
  {
    label: '라인/플랜지 개방',
    score: 4,
    keywords: ['line open', 'flange open', 'flange', '개방'],
  },
  {
    label: '고소작업',
    score: 4,
    keywords: ['working at height', 'height', '고소'],
  },
  { label: '양중/크레인', score: 4, keywords: ['lifting', 'crane', '양중'] },
  { label: '전기작업', score: 3, keywords: ['electrical', '전기'] },
  {
    label: '샘플링/봄베/튜빙',
    score: 3,
    keywords: ['sampling', 'bombe', 'tubing'],
  },
  {
    label: '스팀/응축수/고온',
    score: 3,
    keywords: ['steam', 'condensate', '고온'],
  },
  { label: '질소/N2', score: 4, keywords: ['nitrogen', 'n2', 'n₂'] },
  { label: 'Benzene', score: 3, keywords: ['benzene'] },
  { label: 'Toluene/Xylene', score: 2, keywords: ['toluene', 'xylene'] },
];

const HAZARD_TYPES = [
  {
    name: '협착',
    keywords: ['손', '끼임', '협착', 'strainer', 'pump'],
    focus: '손 위치, 회전체 정지, 커버 제거 전 에너지 차단 확인',
  },
  {
    name: '화상',
    keywords: ['steam', 'condensate', 'hot', '고온', '화상'],
    focus: '잔압/온도 확인, 배출 방향 통제, 보온장갑과 안면보호구 착용',
  },
  {
    name: '누출/분출',
    keywords: ['line open', 'flange', 'drain', 'vent', 'leak', '누출'],
    focus: '차단/배출/블라인드 확인, 개방면 정면 회피, 방유/회수 준비',
  },
  {
    name: '질식',
    keywords: ['n2', 'nitrogen', 'confined space', '밀폐공간'],
    focus: '산소농도 측정, 감시자 배치, 환기와 구조계획 확인',
  },
  {
    name: '추락',
    keywords: ['height', '고소', 'scaffold'],
    focus: '작업발판, 안전대 체결, 개구부와 낙하물 통제',
  },
  {
    name: '화재/폭발',
    keywords: ['hot work', 'welding', '화기', 'lel'],
    focus: 'LEL 측정, 불티 비산 차단, 소화기와 화기감시자 배치',
  },
  {
    name: '중량물',
    keywords: ['crane', 'lifting', '중량물'],
    focus: '인양계획, 신호수, 작업반경 출입통제와 줄걸이 확인',
  },
  {
    name: '감전/오동작',
    keywords: ['electrical', '전기', 'loto'],
    focus: 'LOTO, 무전압 확인, 원격/자동 기동 차단',
  },
];

const LEVEL_META = {
  Low: { label: 'Low', ko: '낮음', className: 'level-low' },
  Medium: { label: 'Medium', ko: '주의', className: 'level-medium' },
  High: { label: 'High', ko: '높음', className: 'level-high' },
};

const PREVIEW_FIELDS = [
  'permitNo',
  'area',
  'equipment',
  'jobType',
  'description',
  'contractor',
  'permitType',
];

const STOP_CRITERIA_LABELS = {
  smellLeak: '냄새/누출',
  residualPressure: '압력 잔류',
  gasAlarm: 'Gas Alarm',
  scopeChange: '작업범위 변경',
  lotoUnclear: 'LOTO 불확실',
  simultaneousInterference: '동시작업 간섭',
};

const STOP_CRITERIA_ORDER = Object.keys(STOP_CRITERIA_LABELS);

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeRows(rows) {
  return rows
    .map((row, index) => {
      const normalized = {};
      Object.keys(FIELD_LABELS).forEach((field) => {
        normalized[field] = normalize(row[field]);
      });

      return {
        ...normalized,
        permitNo: normalized.permitNo || `ROW-${index + 1}`,
      };
    })
    .filter((row) =>
      [
        row.permitNo,
        row.area,
        row.equipment,
        row.jobType,
        row.description,
        row.hazard,
        row.permitType,
      ].some(Boolean)
    );
}

function combinedText(permit) {
  return [
    permit.area,
    permit.equipment,
    permit.jobType,
    permit.description,
    permit.contractor,
    permit.material,
    permit.hazard,
    permit.permitType,
  ]
    .join(' ')
    .toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function classifyRisk(score) {
  if (score >= 8) return LEVEL_META.High;
  if (score >= 4) return LEVEL_META.Medium;
  return LEVEL_META.Low;
}

function isExternalContractor(permit, text) {
  if (hasAny(text, ['contractor', '협력사 작업'])) return true;
  if (!permit.contractor) return false;
  return !/(inhouse|in-house|내부|자체|직영|운전팀|없음|n\/a|-)/i.test(
    permit.contractor
  );
}

function analyzePermits(records) {
  const areaCounts = records.reduce((acc, permit) => {
    const area = permit.area || '미지정 Area';
    acc[area] = (acc[area] || 0) + 1;
    return acc;
  }, {});

  return records.map((permit) => {
    const text = combinedText(permit);
    let riskScore = 0;
    const reasons = [];

    RISK_RULES.forEach((rule) => {
      if (hasAny(text, rule.keywords)) {
        riskScore += rule.score;
        reasons.push(`${rule.label} +${rule.score}`);
      }
    });

    if (isExternalContractor(permit, text)) {
      riskScore += 2;
      reasons.push('협력사 작업 +2');
    }

    if (areaCounts[permit.area || '미지정 Area'] >= 3) {
      riskScore += 2;
      reasons.push('동일 Area 3건 이상 동시작업 +2');
    }

    const hazardTypes = HAZARD_TYPES.filter((type) =>
      hasAny(text, type.keywords)
    ).map((type) => type.name);

    return {
      ...permit,
      riskScore,
      riskLevel: classifyRisk(riskScore),
      riskReasons: reasons,
      hazardTypes,
      safetyInstructions: buildJobInstructions({
        ...permit,
        riskScore,
        riskLevel: classifyRisk(riskScore),
        riskReasons: reasons,
        hazardTypes,
      }),
    };
  });
}

function buildJobInstructions(job) {
  const instructions = [
    '작업허가서, 작업범위, 격리상태, 비상연락체계를 현장에서 함께 확인한다.',
  ];

  if (job.riskLevel.label === 'High') {
    instructions.push(
      'High 작업으로 분류한다. 착수 전 운전팀, 정비팀, Foreman이 현장 조건을 같이 재확인한다.'
    );
  }

  job.hazardTypes.forEach((typeName) => {
    const hazardType = HAZARD_TYPES.find((item) => item.name === typeName);
    if (hazardType) {
      instructions.push(`${typeName}: ${hazardType.focus}.`);
    }
  });

  if (!job.hazardTypes.length) {
    instructions.push(
      '허가조건 변경, 작업방법 변경, 작업장 혼재가 생기면 즉시 멈추고 재승인을 받는다.'
    );
  }

  return [...new Set(instructions)];
}

function getLevelCounts(analyzed) {
  return analyzed.reduce(
    (acc, item) => {
      acc[item.riskLevel.label] += 1;
      return acc;
    },
    { Low: 0, Medium: 0, High: 0 }
  );
}

function getAreaStats(analyzed) {
  const grouped = analyzed.reduce((acc, item) => {
    const area = item.area || '미지정 Area';
    if (!acc[area]) {
      acc[area] = {
        area,
        jobs: [],
        count: 0,
        highCount: 0,
        maxScore: 0,
        totalScore: 0,
      };
    }
    acc[area].jobs.push(item);
    acc[area].count += 1;
    acc[area].totalScore += item.riskScore;
    acc[area].maxScore = Math.max(acc[area].maxScore, item.riskScore);
    if (item.riskLevel.label === 'High') acc[area].highCount += 1;
    return acc;
  }, {});

  return Object.values(grouped)
    .map((area) => ({
      ...area,
      averageScore: area.count ? area.totalScore / area.count : 0,
      topJobs: [...area.jobs]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 3),
      riskLevel: classifyRisk(area.maxScore),
    }))
    .sort((a, b) => b.maxScore - a.maxScore || b.count - a.count);
}

function getHazardStats(analyzed) {
  return HAZARD_TYPES.map((type) => ({
    ...type,
    count: analyzed.filter((job) => job.hazardTypes.includes(type.name)).length,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

function topRiskJobs(analyzed, onlyHigh = false) {
  return analyzed
    .filter((job) => (onlyHigh ? job.riskLevel.label === 'High' : true))
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        a.startTime.localeCompare(b.startTime) ||
        a.permitNo.localeCompare(b.permitNo)
    )
    .slice(0, 5);
}

function listOrFallback(items, fallback) {
  return items.length ? items : [fallback];
}

function buildForemanQuestions(analyzed, areaStats, hazardStats) {
  const highJobs = topRiskJobs(analyzed, true);
  const topJob = highJobs[0] || topRiskJobs(analyzed)[0];
  const topArea = areaStats[0];
  const topHazard = hazardStats.find((item) => item.count > 0);

  const jobLabel = topJob
    ? `${topJob.area || '미지정 Area'} ${topJob.equipment || topJob.jobType}`
    : '오늘 작업';

  return [
    `${jobLabel} 작업의 차단, 배출, LOTO, 가스측정 결과를 누가 현장에서 최종 확인했습니까?`,
    `${topArea?.area || '주요 Area'}에서 동시에 진행되는 작업끼리 충돌하거나 서로 위험을 키우는 지점은 어디입니까?`,
    `${topHazard?.name || '주요 위험'} 위험을 직접 받는 작업자는 누구이며, 그 작업자의 대피 방향은 어디입니까?`,
    `작업 중 조건이 달라졌을 때 Foreman에게 즉시 알릴 신호와 연락 방법을 모두 알고 있습니까?`,
    `오늘 작업을 멈춰야 하는 기준을 작업자 전원이 같은 문장으로 말할 수 있습니까?`,
  ];
}

function buildStopCriteria(analyzed) {
  const hazards = new Set(analyzed.flatMap((job) => job.hazardTypes));
  const criteria = [
    '작업허가서의 작업범위, 인원, 설비, 시간, 작업방법이 실제 현장과 다를 때',
    '격리, LOTO, 블라인드, 잔압 제거, 드레인/벤트 상태를 현장에서 확인하지 못할 때',
    '보호구, 감시자, 소화기, 대피로, 통신수단 중 하나라도 준비되지 않았을 때',
    '동시작업으로 낙하물, 화기, 누출, 인양 반경이 겹치는데 통제선이 없을 때',
  ];

  if (hazards.has('질식')) {
    criteria.push('산소농도, 유해가스 측정값이 기준 밖이거나 연속 측정이 끊겼을 때');
  }
  if (hazards.has('화재/폭발')) {
    criteria.push('LEL 측정값 이상, 불티 비산 차단 실패, 화기감시자 이탈이 발생했을 때');
  }
  if (hazards.has('화상')) {
    criteria.push('Steam, Condensate, 고온부 잔압 또는 온도를 확인할 수 없을 때');
  }
  if (hazards.has('중량물')) {
    criteria.push('인양 반경 내 출입통제, 신호수, 줄걸이 상태가 유지되지 않을 때');
  }
  if (hazards.has('감전/오동작')) {
    criteria.push('무전압 확인, LOTO 표식, 원격기동 차단 중 하나라도 불명확할 때');
  }

  return criteria;
}

function buildBriefing(analyzed, areaStats, hazardStats, questions, stopCriteria) {
  const highJobs = topRiskJobs(analyzed, true);
  const highText = highJobs.length
    ? highJobs
        .map(
          (job) =>
            `${job.area} ${job.equipment || job.jobType}(${job.riskScore}점)`
        )
        .join(', ')
    : 'High 등급 작업은 없습니다';
  const focusHazards = hazardStats
    .filter((item) => item.count > 0)
    .slice(0, 3)
    .map((item) => `${item.name} ${item.count}건`)
    .join(', ');

  return [
    `좋은 아침입니다. 오늘 작업허가서 기준 총 ${analyzed.length}건의 작업을 확인했습니다. High 작업은 ${highJobs.length}건이며, 우선 확인 대상은 ${highText}입니다.`,
    `첫째, 오늘은 ${areaStats[0]?.area || '주요 Area'}의 동시작업 위험을 먼저 보겠습니다. 같은 Area 안에서 작업반경, 배출 방향, 화기, 인양 동선이 겹치는지 확인하십시오.`,
    `둘째, 집중 위험유형은 ${focusHazards || '등록된 위험유형 없음'}입니다. 익숙한 반복작업에서도 손 협착, 화상, 누출, 질식이 발생할 수 있으므로 손 위치와 몸 위치를 먼저 정하십시오.`,
    `셋째, Foreman 질문입니다. ${questions[0]} 그리고 ${questions[2]}`,
    `마지막으로 작업중지 기준입니다. ${stopCriteria[0]} 또한 ${stopCriteria[1]} 작업을 멈추고 재확인하십시오. 오늘 목표는 작업을 빨리 끝내는 것이 아니라, 허가조건 그대로 안전하게 끝내는 것입니다.`,
  ].join('\n\n');
}

function buildReport(analyzed) {
  const levelCounts = getLevelCounts(analyzed);
  const areaStats = getAreaStats(analyzed);
  const hazardStats = getHazardStats(analyzed);
  const highJobs = topRiskJobs(analyzed, true);
  const questions = buildForemanQuestions(analyzed, areaStats, hazardStats);
  const stopCriteria = buildStopCriteria(analyzed);
  const briefing = buildBriefing(
    analyzed,
    areaStats,
    hazardStats,
    questions,
    stopCriteria
  );

  const riskSummary = [
    `총 작업허가서 ${analyzed.length}건`,
    `High ${levelCounts.High}건, Medium ${levelCounts.Medium}건, Low ${levelCounts.Low}건`,
    `최고 위험 Area: ${areaStats[0]?.area || '없음'} (${areaStats[0]?.maxScore ?? 0}점)`,
    `주요 위험유형: ${
      hazardStats
        .filter((item) => item.count > 0)
        .slice(0, 3)
        .map((item) => `${item.name} ${item.count}건`)
        .join(', ') || '없음'
    }`,
  ];

  return {
    levelCounts,
    areaStats,
    hazardStats,
    highJobs,
    questions,
    stopCriteria,
    briefing,
    text: [
      '1. 오늘의 위험 요약',
      ...riskSummary.map((line) => `- ${line}`),
      '',
      '2. 고위험 작업 Top 5',
      ...listOrFallback(
        highJobs.map(
          (job, index) =>
            `${index + 1}. [${job.riskScore}점/${job.riskLevel.label}] ${job.area} | ${job.equipment || '-'} | ${job.description || job.jobType} | ${job.riskReasons.join(', ')}`
        ),
        '- High 등급 작업 없음'
      ),
      '',
      '3. Area별 주의 작업',
      ...listOrFallback(
        areaStats.map(
          (area) =>
            `- ${area.area}: ${area.count}건, High ${area.highCount}건, 최고 ${area.maxScore}점, 주의작업 ${area.topJobs
              .map((job) => `${job.equipment || job.jobType} ${job.riskScore}점`)
              .join(' / ')}`
        ),
        '- Area 데이터 없음'
      ),
      '',
      '4. 위험유형별 집중 포인트',
      ...listOrFallback(
        hazardStats
          .filter((item) => item.count > 0)
          .map((item) => `- ${item.name} ${item.count}건: ${item.focus}`),
        '- 매핑된 위험유형 없음'
      ),
      '',
      '5. Foreman 안전 질문',
      ...questions.map((question, index) => `${index + 1}. ${question}`),
      '',
      '6. 작업중지 기준',
      ...stopCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
      '',
      '7. 5분 TBM 브리핑',
      briefing,
      '',
      '8. 작업별 안전지시',
      ...[...analyzed]
        .sort((a, b) => b.riskScore - a.riskScore)
        .map(
          (job) =>
            `- ${job.permitNo} | ${job.area} | ${job.equipment || job.jobType} | ${job.riskScore}점 ${job.riskLevel.label}: ${job.safetyInstructions.join(' ')}`
        ),
      '',
      REQUIRED_NOTICE,
    ].join('\n'),
  };
}

function buildAiReport(baseReport, analyzed, aiDraft) {
  const fixedOverview = {
    totalCount: aiDraft?.overview?.totalCount ?? analyzed.length,
    highCount: aiDraft?.overview?.highCount ?? baseReport.levelCounts.High,
    mediumCount: aiDraft?.overview?.mediumCount ?? baseReport.levelCounts.Medium,
    lowCount: aiDraft?.overview?.lowCount ?? baseReport.levelCounts.Low,
    topHazardTypes: withFallback(
      aiDraft?.overview?.topHazardTypes,
      baseReport.hazardStats
        .filter((hazard) => hazard.count > 0)
        .slice(0, 3)
        .map((hazard) => `${hazard.name} ${hazard.count}건`)
    ).slice(0, 3),
  };

  const highRiskDetails = buildHighRiskDetails(baseReport, aiDraft);
  const fixedStopCriteria = normalizeFixedStopCriteria(aiDraft?.stopCriteria);
  const briefing = String(
    aiDraft?.tbmBriefing || aiDraft?.briefing || baseReport.briefing
  ).trim();

  return {
    ...baseReport,
    fixedOverview,
    highRiskDetails,
    fixedStopCriteria,
    briefing,
    safetyResponsibilityNotice:
      aiDraft?.safetyResponsibilityNotice || REQUIRED_NOTICE,
    aiMeta: aiDraft
      ? {
          generatedAt: aiDraft.generatedAt,
          model: aiDraft.model,
          provider: aiDraft.provider,
        }
      : null,
    text: buildFixedReportText({
      overview: fixedOverview,
      highRiskDetails,
      briefing,
      stopCriteria: fixedStopCriteria,
      safetyResponsibilityNotice:
        aiDraft?.safetyResponsibilityNotice || REQUIRED_NOTICE,
      sourceLabel: aiDraft
        ? `AI API 생성${aiDraft.provider ? ` · ${aiDraft.provider}` : ''}${aiDraft.model ? ` · ${aiDraft.model}` : ''}`
        : 'Rule-based 기본 문안',
    }),
  };
}

function buildHighRiskDetails(baseReport, aiDraft) {
  const aiItems = Array.isArray(aiDraft?.highRiskTop5) ? aiDraft.highRiskTop5 : [];

  return baseReport.highJobs.slice(0, 5).map((job) => {
    const aiItem =
      aiItems.find((item) => String(item.permitNo || '') === job.permitNo) || {};

    return {
      permitNo: job.permitNo,
      area: job.area || '미지정 Area',
      jobName: aiItem.jobName || job.equipment || job.description || job.jobType,
      hazardTypes: withFallback(aiItem.hazardTypes, job.hazardTypes),
      whyDangerous:
        aiItem.whyDangerous ||
        `${job.riskReasons.join(', ') || '작업조건 변화 시 위험 상승'} 때문에 ${job.area}에서 작업자 위치와 격리상태를 확인해야 합니다.`,
      foremanQuestion:
        aiItem.foremanQuestion ||
        `${job.area} ${job.equipment || job.jobType} 작업의 차단, 잔압, 대피 방향을 누가 현장에서 확인했습니까?`,
      stopCriteria:
        aiItem.stopCriteria ||
        `${job.area} ${job.equipment || job.jobType} 작업 조건이 허가서와 다르거나 누출·알람·잔압이 확인되면 즉시 중지한다.`,
    };
  });
}

function buildFixedReportText({
  overview,
  highRiskDetails,
  briefing,
  stopCriteria,
  safetyResponsibilityNotice,
  sourceLabel,
}) {
  return [
    sourceLabel ? `[${sourceLabel}]` : '',
    '1. 오늘의 위험 총괄',
    `- 전체 작업 건수: ${overview.totalCount}건`,
    `- High / Medium / Low 건수: ${overview.highCount} / ${overview.mediumCount} / ${overview.lowCount}건`,
    '- 가장 주의할 위험유형 Top 3',
    ...overview.topHazardTypes.map((hazard) => `  - ${hazard}`),
    '',
    '2. 고위험 작업 Top 5',
    ...listOrFallback(
      highRiskDetails.map(
        (job, index) =>
          [
            `${index + 1}. ${job.jobName}`,
            `- Permit No: ${job.permitNo}`,
            `- Area: ${job.area}`,
            `- 작업명: ${job.jobName}`,
            `- 위험유형: ${job.hazardTypes.join(', ') || '미지정'}`,
            `- 왜 위험한지: ${job.whyDangerous}`,
            `- Foreman 확인 질문: ${job.foremanQuestion}`,
            `- 작업중지 기준: ${job.stopCriteria}`,
          ].join('\n')
      ),
      '- High 등급 작업 없음'
    ),
    '',
    '3. 5분 TBM 브리핑',
    briefing,
    '',
    '4. 작업중지 기준',
    ...STOP_CRITERIA_ORDER.map(
      (key) => `- ${STOP_CRITERIA_LABELS[key]}: ${stopCriteria[key]}`
    ),
    '',
    '5. 안전 책임한계 문구',
    safetyResponsibilityNotice,
  ]
    .filter((line, index) => line || index !== 0)
    .join('\n');
}

function withFallback(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function normalizeFixedStopCriteria(value) {
  const fallback = {
    smellLeak:
      '냄새가 나거나 Drain, Vent, Flange 주변에서 액체 또는 가스 누출이 보이면 작업을 중지한다.',
    residualPressure:
      '압력계, 드레인, 벤트로 잔압 제거가 확인되지 않으면 개방 작업을 시작하지 않는다.',
    gasAlarm:
      '휴대용 또는 고정식 Gas Alarm이 울리거나 측정값이 기준 밖이면 즉시 대피하고 재측정한다.',
    scopeChange:
      '작업위치, 설비, 방법, 인원, 시간이 허가서와 달라지면 작업허가를 재확인한다.',
    lotoUnclear:
      'LOTO 표식, 무전압 확인, 차단 밸브 상태 중 하나라도 불확실하면 작업을 중지한다.',
    simultaneousInterference:
      '화기, 인양, 개방, 고소 작업 반경이 겹치는데 통제선과 신호수가 없으면 작업을 중지한다.',
  };

  return STOP_CRITERIA_ORDER.reduce((acc, key) => {
    acc[key] =
      value && typeof value === 'object' && !Array.isArray(value) && value[key]
        ? String(value[key]).trim()
        : fallback[key];
    return acc;
  }, {});
}

function App() {
  const [records, setRecords] = useState([]);
  const [sourceName, setSourceName] = useState('샘플 CSV');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [aiDraft, setAiDraft] = useState(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const fileInputRef = useRef(null);

  const analyzed = useMemo(() => analyzePermits(records), [records]);
  const report = useMemo(() => buildReport(analyzed), [analyzed]);
  const displayReport = useMemo(
    () => buildAiReport(report, analyzed, aiDraft),
    [report, analyzed, aiDraft]
  );
  const sortedJobs = useMemo(() => topRiskJobs(analyzed), [analyzed]);

  useEffect(() => {
    loadSample();
  }, []);

  function parseCsvText(text, name) {
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
    });

    if (parsed.errors.length) {
      setError(`CSV 파싱 오류: ${parsed.errors[0].message}`);
      return;
    }

    const normalizedRows = normalizeRows(parsed.data);
    if (!normalizedRows.length) {
      setError('읽을 수 있는 작업허가서 데이터가 없습니다.');
      return;
    }

    setRecords(normalizedRows);
    setSourceName(name);
    setAiDraft(null);
    setError('');
    setStatus(`${normalizedRows.length}건의 작업허가서를 불러왔습니다.`);
  }

  async function loadSample() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample-permits.csv`);
      const text = await response.text();
      parseCsvText(text, '샘플 CSV');
    } catch {
      setError('샘플 CSV를 불러오지 못했습니다.');
    }
  }

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        if (result.errors.length) {
          setError(`CSV 파싱 오류: ${result.errors[0].message}`);
          return;
        }
        const normalizedRows = normalizeRows(result.data);
        if (!normalizedRows.length) {
          setError('읽을 수 있는 작업허가서 데이터가 없습니다.');
          return;
        }
        setRecords(normalizedRows);
        setSourceName(file.name);
        setAiDraft(null);
        setError('');
        setStatus(`${normalizedRows.length}건의 작업허가서를 불러왔습니다.`);
      },
      error: (parseError) => {
        setError(`CSV를 읽지 못했습니다: ${parseError.message}`);
      },
    });
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const syntheticEvent = { target: { files: [file] } };
    handleFileUpload(syntheticEvent);
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(displayReport.text);
      setStatus('TBM 브리핑 결과를 클립보드에 복사했습니다.');
    } catch {
      setError('클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.');
    }
  }

  function downloadReport() {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([displayReport.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `permit-to-tbm-briefing-${date}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('TBM 브리핑 결과 파일을 다운로드했습니다.');
  }

  async function generateAiBriefing() {
    if (!analyzed.length) {
      setError('AI 브리핑을 생성할 작업허가서 데이터가 없습니다.');
      return;
    }

    setIsGeneratingAi(true);
    setError('');
    setStatus('AI가 오늘의 TBM 브리핑을 생성 중입니다.');

    try {
      const response = await fetch('/api/tbm-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permits: analyzed,
          areaStats: report.areaStats,
          hazardStats: report.hazardStats,
          highJobs: report.highJobs,
          baseline: {
            questions: report.questions,
            stopCriteria: report.stopCriteria,
            briefing: report.briefing,
            safetyNotice: REQUIRED_NOTICE,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'AI 브리핑 생성 API 호출에 실패했습니다.');
      }

      setAiDraft({ ...data.result, model: data.model, provider: data.provider });
      setStatus(
        `AI 브리핑을 생성했습니다${data.provider ? ` · ${data.provider}` : ''}${data.model ? ` · ${data.model}` : ''}.`
      );
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setIsGeneratingAi(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="top-section">
        <div className="topbar">
          <div>
            <p className="eyebrow">Permit-to-TBM Copilot</p>
            <h1>오늘의 작업위험 브리핑 AI</h1>
          </div>
          <span className="mode-badge">
            {aiDraft ? 'Rule-based + AI API' : 'Rule-based · AI API 준비'}
          </span>
        </div>

        <div className="intro-grid">
          <section className="opening-panel" aria-labelledby="opening-title">
            <h2 id="opening-title">오늘의 작업위험을 5분 안에 브리핑합니다</h2>
            <p>
              당일 작업허가서 CSV를 넣으면 작업별 위험점수, High 작업,
              Area별 동시작업, Foreman 질문과 작업중지 기준을 바로 만듭니다.
            </p>
            <div className="notice-strip">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>{REQUIRED_NOTICE}</span>
            </div>
          </section>

          <section
            className="upload-zone"
            aria-label="CSV 업로드"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <FileSpreadsheet size={28} aria-hidden="true" />
            <div>
              <strong>CSV 파일 업로드</strong>
              <span>{sourceName} · {records.length}건 분석 중</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              hidden
            />
            <div className="upload-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => fileInputRef.current?.click()}
                title="CSV 파일 선택"
              >
                <Upload size={18} aria-hidden="true" />
                CSV 선택
              </button>
              <button type="button" onClick={loadSample} title="샘플 데이터 불러오기">
                샘플 불러오기
              </button>
              <a href={`${import.meta.env.BASE_URL}sample-permits.csv`} download>
                샘플 CSV 다운로드
              </a>
            </div>
          </section>
        </div>

        {(status || error) && (
          <div className={error ? 'message message-error' : 'message'}>
            {error || status}
          </div>
        )}
      </header>

      <main>
        <section className="metrics-grid" aria-label="위험 등급 요약">
          {Object.values(LEVEL_META).map((level) => (
            <article key={level.label} className={`metric-card ${level.className}`}>
              <span>{level.label}</span>
              <strong>{displayReport.levelCounts[level.label]}</strong>
              <small>{level.ko} 위험 작업</small>
            </article>
          ))}
          <article className="metric-card metric-total">
            <span>전체 작업</span>
            <strong>{analyzed.length}</strong>
            <small>작업허가서 기준</small>
          </article>
        </section>

        <section className="content-grid">
          <div className="stack">
            <SectionTitle
              icon={<AlertTriangle size={20} />}
              title="고위험 작업 Top 5"
              subtitle="High 등급 작업을 점수순으로 표시"
            />
            <div className="high-risk-list">
              {displayReport.highJobs.length ? (
                displayReport.highJobs.map((job, index) => (
                  <article key={job.permitNo} className="high-risk-card">
                    <div className="rank">{index + 1}</div>
                    <div>
                      <div className="job-headline">
                        <strong>{job.area}</strong>
                        <span>{job.riskScore}점 · {job.riskLevel.label}</span>
                      </div>
                      <h3>{job.equipment || job.jobType}</h3>
                      <p>{job.description || job.hazard}</p>
                      <div className="tag-row">
                        {job.hazardTypes.map((type) => (
                          <span key={type}>{type}</span>
                        ))}
                        {job.riskReasons.slice(0, 3).map((reason) => (
                          <span key={reason}>{reason}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-text">High 등급 작업이 없습니다.</p>
              )}
            </div>
          </div>

          <div className="stack">
            <SectionTitle
              icon={<Map size={20} />}
              title="Area/Unit 위험 작업 Map"
              subtitle="Area별 최고점과 동시작업을 확인"
            />
            <div className="area-map">
              {displayReport.areaStats.map((area) => (
                <article
                  key={area.area}
                  className={`area-tile ${area.riskLevel.className}`}
                >
                  <div className="area-top">
                    <strong>{area.area}</strong>
                    <span>{area.maxScore}점</span>
                  </div>
                  <div className="heat-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(area.maxScore * 7, 100)}%` }} />
                  </div>
                  <p>
                    {area.count}건 · High {area.highCount}건 · 평균{' '}
                    {area.averageScore.toFixed(1)}점
                  </p>
                  <ul>
                    {area.topJobs.map((job) => (
                      <li key={job.permitNo}>
                        {job.equipment || job.jobType} · {job.riskScore}점
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="content-grid content-grid-balanced">
          <div className="stack">
            <SectionTitle
              icon={<Flame size={20} />}
              title="위험유형별 집계"
              subtitle="협착, 화상, 누출, 질식 등 집중 포인트"
            />
            <div className="hazard-bars">
              {displayReport.hazardStats.map((hazard) => {
                const max = Math.max(...displayReport.hazardStats.map((item) => item.count), 1);
                return (
                  <article key={hazard.name} className="hazard-row">
                    <div>
                      <strong>{hazard.name}</strong>
                      <span>{hazard.count}건</span>
                    </div>
                    <div className="bar-track" aria-hidden="true">
                      <span style={{ width: `${(hazard.count / max) * 100}%` }} />
                    </div>
                    <p>{hazard.focus}</p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="stack">
            <SectionTitle
              icon={<Gauge size={20} />}
              title="작업허가서 데이터 미리보기"
              subtitle="업로드된 원천 데이터와 산출 점수"
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {PREVIEW_FIELDS.map((field) => (
                      <th key={field}>{FIELD_LABELS[field]}</th>
                    ))}
                    <th>Risk</th>
                    <th>Level</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedJobs.slice(0, 8).map((job) => (
                    <tr key={job.permitNo}>
                      {PREVIEW_FIELDS.map((field) => (
                        <td key={field}>{job[field] || '-'}</td>
                      ))}
                      <td>{job.riskScore}</td>
                      <td>
                        <span className={`level-pill ${job.riskLevel.className}`}>
                          {job.riskLevel.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="report-section">
          <div className="report-header">
            <SectionTitle
              icon={<ClipboardCopy size={20} />}
              title="오늘의 TBM 결과"
              subtitle="복사하거나 파일로 내려받아 아침 회의에서 바로 사용"
            />
            <div className="report-actions">
              <button
                type="button"
                className="ai-button"
                onClick={generateAiBriefing}
                disabled={isGeneratingAi || !analyzed.length}
                title="AI API로 TBM 브리핑 생성"
              >
                <HelpCircle size={18} aria-hidden="true" />
                {isGeneratingAi ? 'AI 생성 중' : 'AI 브리핑 생성'}
              </button>
              <button type="button" onClick={copyReport} title="결과 복사">
                <ClipboardCopy size={18} aria-hidden="true" />
                결과 복사
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={downloadReport}
                title="결과 다운로드"
              >
                <Download size={18} aria-hidden="true" />
                결과 다운로드
              </button>
            </div>
          </div>

          <div className="report-grid">
            <ReportBlock title="1. 오늘의 위험 총괄">
              <ul>
                <li>전체 작업 건수: {displayReport.fixedOverview.totalCount}건</li>
                <li>
                  High / Medium / Low:{' '}
                  {displayReport.fixedOverview.highCount} /{' '}
                  {displayReport.fixedOverview.mediumCount} /{' '}
                  {displayReport.fixedOverview.lowCount}건
                </li>
              </ul>
              <h4>가장 주의할 위험유형 Top 3</h4>
              <ol>
                {displayReport.fixedOverview.topHazardTypes.map((hazard) => (
                  <li key={hazard}>{hazard}</li>
                ))}
              </ol>
            </ReportBlock>

            <ReportBlock title="2. 고위험 작업 Top 5" wide>
              <div className="fixed-top-list">
                {listOrFallback(
                  displayReport.highRiskDetails.map((job, index) => (
                    <article key={job.permitNo} className="fixed-top-item">
                      <div className="fixed-top-heading">
                        <span>{index + 1}</span>
                        <strong>{job.jobName}</strong>
                      </div>
                      <dl>
                        <dt>Permit No</dt>
                        <dd>{job.permitNo}</dd>
                        <dt>Area</dt>
                        <dd>{job.area}</dd>
                        <dt>작업명</dt>
                        <dd>{job.jobName}</dd>
                        <dt>위험유형</dt>
                        <dd>{job.hazardTypes.join(', ') || '미지정'}</dd>
                        <dt>왜 위험한지</dt>
                        <dd>{job.whyDangerous}</dd>
                        <dt>Foreman 확인 질문</dt>
                        <dd>{job.foremanQuestion}</dd>
                        <dt>작업중지 기준</dt>
                        <dd>{job.stopCriteria}</dd>
                      </dl>
                    </article>
                  )),
                  <p key="no-high" className="empty-text">High 등급 작업 없음</p>
                )}
              </div>
            </ReportBlock>

            <ReportBlock title="3. 5분 TBM 브리핑" wide>
              {displayReport.aiMeta && (
                <p className="ai-source">
                  AI API 생성 결과
                  {displayReport.aiMeta.provider
                    ? ` · ${displayReport.aiMeta.provider}`
                    : ''}
                  {displayReport.aiMeta.model ? ` · ${displayReport.aiMeta.model}` : ''}
                </p>
              )}
              <p className="briefing-text">{displayReport.briefing}</p>
            </ReportBlock>

            <ReportBlock title="4. 작업중지 기준">
              <dl className="stop-criteria-list">
                {STOP_CRITERIA_ORDER.map((key) => (
                  <div key={key}>
                    <dt>{STOP_CRITERIA_LABELS[key]}</dt>
                    <dd>{displayReport.fixedStopCriteria[key]}</dd>
                  </div>
                ))}
              </dl>
            </ReportBlock>

            <ReportBlock title="5. 안전 책임한계 문구">
              <p>{displayReport.safetyResponsibilityNotice}</p>
            </ReportBlock>
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }) {
  return (
    <div className="section-title">
      <span aria-hidden="true">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function ReportBlock({ title, children, wide = false }) {
  return (
    <article className={wide ? 'report-block report-block-wide' : 'report-block'}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

export default App;
