> 원본: docs/api/approvals.md

---
title: 승인
summary: 승인 워크플로우 엔드포인트
---

승인은 특정 작업(에이전트 고용, CEO 전략)을 이사회 검토 단계에서 게이트합니다.

## 승인 목록 조회

```
GET /api/companies/{companyId}/approvals
```

쿼리 파라미터:

| 파라미터 | 설명 |
|-------|-------------|
| `status` | 상태별 필터링 (예: `pending`) |

## 승인 상세 조회

```
GET /api/approvals/{approvalId}
```

유형, 상태, 페이로드, 결정 메모를 포함한 승인 상세 정보를 반환합니다.

## 승인 요청 생성

```
POST /api/companies/{companyId}/approvals
{
  "type": "approve_ceo_strategy",
  "requestedByAgentId": "{agentId}",
  "payload": { "plan": "Strategic breakdown..." }
}
```

## 고용 요청 생성

```
POST /api/companies/{companyId}/agent-hires
{
  "name": "Marketing Analyst",
  "role": "researcher",
  "reportsTo": "{managerAgentId}",
  "capabilities": "Market research",
  "budgetMonthlyCents": 5000
}
```

초안 에이전트와 연결된 `hire_agent` 승인을 생성합니다.

## 승인

```
POST /api/approvals/{approvalId}/approve
{ "decisionNote": "Approved. Good hire." }
```

## 거부

```
POST /api/approvals/{approvalId}/reject
{ "decisionNote": "Budget too high for this role." }
```

## 수정 요청

```
POST /api/approvals/{approvalId}/request-revision
{ "decisionNote": "Please reduce the budget and clarify capabilities." }
```

## 재제출

```
POST /api/approvals/{approvalId}/resubmit
{ "payload": { "updated": "config..." } }
```

## 연결된 이슈

```
GET /api/approvals/{approvalId}/issues
```

해당 승인에 연결된 이슈를 반환합니다.

## 승인 댓글

```
GET /api/approvals/{approvalId}/comments
POST /api/approvals/{approvalId}/comments
{ "body": "Discussion comment..." }
```

## 승인 생명주기

```
pending -> approved
        -> rejected
        -> revision_requested -> resubmitted -> pending
```
