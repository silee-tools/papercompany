# Paperclip 개발 가이드

## 서버 로그 확인

### 로그 파일 위치

```
~/.paperclip/instances/{PAPERCLIP_INSTANCE_ID}/logs/
```

- `PAPERCLIP_INSTANCE_ID`는 `.env`에서 설정 (기본값: `default`)
- 워크트리별로 인스턴스가 다를 수 있음 — 반드시 `.env`의 `PAPERCLIP_INSTANCE_ID` 확인
- 환경변수 `PAPERCLIP_LOG_DIR`로 경로 직접 변경 가능
- `pino-roll` 사용: 일별 로테이션, 최대 30MB, 7개 파일 보존
- 활성 로그 파일은 `server.N.log` (N이 가장 큰 파일이 최신)
- `server.log`는 롤링 전 레거시 파일일 수 있음 — 용량이 크면 삭제 가능

### 로그 확인 명령어

```bash
# 1. 현재 인스턴스 확인
grep PAPERCLIP_INSTANCE_ID .env

# 2. 가장 최신 로그 파일 찾기
ls -lt ~/.paperclip/instances/${INSTANCE_ID}/logs/ | head -3

# 3. 실시간 에러 확인 (최신 파일 지정)
tail -f ~/.paperclip/instances/${INSTANCE_ID}/logs/server.N.log | jq 'select(.level >= 40)'

# 4. 최근 에러만 보기
tail -500 ~/.paperclip/instances/${INSTANCE_ID}/logs/server.N.log | jq 'select(.level >= 40)'

# DB 에러 확인 (PostgreSQL)
docker logs papercompany-db-1 --tail 30
docker logs papercompany-db-1 --since 30s  # 최근 30초
```

### 로그 레벨

| 레벨 | 숫자 | 설명 |
|------|------|------|
| debug | 20 | 파일에만 기록 |
| info | 30 | 콘솔 + 파일 (기본) |
| warn | 40 | 경고 |
| error | 50 | 에러 |
| fatal | 60 | uncaughtException 등 |

- 콘솔 레벨: `PAPERCLIP_LOG_LEVEL` 환경변수 (기본 `info`)
- 파일 레벨: 항상 `debug`

### 주의사항

- `console.error`/`console.warn` 호출도 pino를 통해 로그 파일에 기록됨
- `uncaughtException`, `unhandledRejection`도 로그 파일에 기록됨
- DB 테이블 에러(`relation does not exist`)는 마이그레이션 누락이 원인 → `pnpm db:migrate` 실행 후 서버 재시작

## 개발 환경

### 워크트리 구조

| 디렉토리 | 브랜치 | 인스턴스 | DB |
|----------|--------|---------|-----|
| `papercompany/` | main | default | `papercompany_dev` |
| `papercompany-stable/` | stable | stable | `papercompany_stable` |

- 각 워크트리는 별도 `.env`를 가지며, `DATABASE_URL`과 `PAPERCLIP_INSTANCE_ID`가 다름
- 서버 에러 디버깅 시 **어느 워크트리에서 서버가 실행 중인지** 반드시 확인
- 로그 경로도 인스턴스별로 분리됨

### DB 마이그레이션

```bash
pnpm db:migrate
```

- Docker PostgreSQL 사용: `papercompany-db-1` 컨테이너
- 마이그레이션 후 반드시 서버 재시작 필요 (DB 커넥션 풀 갱신)
- **주의**: 마이그레이션은 `DATABASE_URL`이 가리키는 DB에만 적용됨
  - main 워크트리에서 실행 → `papercompany_dev`에만 적용
  - stable 워크트리에서 실행 → `papercompany_stable`에만 적용
- **주의**: 마이그레이션 기록(`drizzle.__drizzle_migrations`)만 있고 실제 테이블이 없을 수 있음 — DB에 다른 스키마가 선점한 경우 발생. `\dt`로 테이블 존재 여부 직접 확인할 것

### 서버 실행

```bash
pnpm dev          # watch 모드
pnpm dev:once     # 1회 실행
pnpm dev:server   # 서버만
pnpm dev:ui       # UI만
```
