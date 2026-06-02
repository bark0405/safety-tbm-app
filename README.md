# Permit-to-TBM Copilot

한국어 앱 제목: 오늘의 작업위험 브리핑 AI

작업허가서 CSV를 업로드하면 Rule-based 로직으로 작업별 Risk Score, Risk Level, 고위험 작업 Top 5, Area별 위험 Map, 위험유형별 집계를 계산합니다. OpenAI API 키를 설정하면 `/api/tbm-briefing` 백엔드를 통해 고정된 5개 섹션의 AI TBM 브리핑을 생성할 수 있습니다.

## 실행

```bash
npm install
npm run build
npm start
```

서버 주소는 기본 `http://127.0.0.1:5173/`입니다. `npm start`는 빌드된 정적 앱과 API endpoint를 같은 포트에서 제공합니다.

## Gemini 또는 OpenAI API 설정

`.env.example`을 참고해 앱 폴더에 `.env` 파일을 만듭니다.

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=5173
```

OpenAI를 사용할 때는 아래처럼 바꿉니다.

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4-mini
PORT=5173
```

PowerShell에서 시스템 환경변수로 설정할 수도 있습니다. Gemini 예시는 아래와 같습니다.

```powershell
setx AI_PROVIDER "gemini"
setx GEMINI_API_KEY "your_gemini_api_key_here"
```

환경변수를 바꾼 뒤에는 서버를 다시 시작해야 합니다.

중요: 실제 API 키는 `.env`에 넣고, `.env.example`에는 넣지 마세요. `.env.example`은 공유용 샘플 파일입니다.

## API Endpoint

```txt
POST /api/tbm-briefing
```

프론트엔드는 작업허가서 분석 결과를 이 endpoint로 보내고, 서버는 OpenAI Responses API를 호출해 아래 구조의 JSON을 반환합니다.

```json
{
  "overview": {
    "totalCount": 0,
    "highCount": 0,
    "mediumCount": 0,
    "lowCount": 0,
    "topHazardTypes": []
  },
  "highRiskTop5": [
    {
      "permitNo": "",
      "area": "",
      "jobName": "",
      "hazardTypes": [],
      "whyDangerous": "",
      "foremanQuestion": "",
      "stopCriteria": ""
    }
  ],
  "tbmBriefing": "",
  "stopCriteria": {
    "smellLeak": "",
    "residualPressure": "",
    "gasAlarm": "",
    "scopeChange": "",
    "lotoUnclear": "",
    "simultaneousInterference": ""
  },
  "safetyResponsibilityNotice": ""
}
```

화면과 복사/다운로드 결과는 아래 순서로 고정됩니다.

1. 오늘의 위험 총괄
2. 고위험 작업 Top 5
3. 5분 TBM 브리핑
4. 작업중지 기준
5. 안전 책임한계 문구

## 빌드

```bash
npm run build
```

## CSV 컬럼

필수 예시 컬럼:

- `permitNo`
- `area`
- `equipment`
- `jobType`
- `description`
- `contractor`
- `startTime`
- `endTime`
- `material`
- `hazard`
- `permitType`

샘플 CSV는 `public/sample-permits.csv`에 있습니다.

## 안전 문구

본 앱은 작업 전 위험성 인식과 TBM 보조용입니다. 최종 작업 허가와 안전 판단은 현장 SOP, 법규, 작업허가 승인권자 기준을 우선해야 합니다.
