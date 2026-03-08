---
description: upstream/master를 현재 브랜치에 backmerge (교육적 변경 요약 포함)
allowed-tools: Bash(git *), Bash(pnpm *)
---

# Backmerge: upstream/master -> 현재 브랜치

upstream 저장소(`paperclipai/paperclip`)의 master 브랜치를 현재 브랜치에 머지합니다.
변경사항을 교육적으로 요약하여 사용자가 upstream의 발전 방향을 이해할 수 있게 합니다.

## 실행 절차

아래 단계를 순서대로 실행하세요. 각 단계에서 오류가 발생하면 즉시 중단하고 사용자에게 알려주세요.

### 1. 사전 확인

- `git remote -v`로 upstream 리모트 존재 확인. 없으면 중단하고 `git remote add upstream <url>` 안내.
- `git status --porcelain`으로 작업 디렉토리 클린 확인. dirty면 중단하고 stash/commit 안내.
- `git branch --show-current`로 현재 브랜치명 출력.

### 2. Fetch

- `git fetch upstream` 실행.

### 3. 차이 분석

- `git log --oneline HEAD..upstream/master`로 새 커밋 목록 확인.
- 커밋이 0개면 "이미 최신 상태입니다" 출력 후 종료.
- 커밋 개수 출력.

### 4. 교육적 변경 요약

커밋 로그(`git log --format="%h %s%n%b" HEAD..upstream/master`)와 변경 통계(`git diff --stat HEAD...upstream/master`)를 분석하여 아래 형식으로 출력.

**반드시 각 항목마다 3가지를 포함**:
1. **변경 내용**: 무엇이 바뀌었는지 (사실 기반)
2. **배경 지식**: 해당 변경에 적용된 설계 원칙, 기술적 배경, 패턴을 가르치듯 설명. "왜 이렇게 했는지", "어떤 원리가 적용됐는지", "왜 이 버그가 발생하는지"
3. **우리에게 미치는 영향**: 우리 fork(승인 워크플로우, 한국어 문서, 로깅 등)에 어떤 구체적 영향을 미치는지

카테고리: 새 기능 / 버그 수정 / 개선-리팩토링 / 문서-CI

### 5. 기능적 모순 및 변경 충돌 분석

**반드시 수행**: upstream 변경이 우리의 최근 변경사항과 기능적으로 모순되거나, 우리가 추가/수정한 코드를 뒤집는 결과를 초래하는지 분석한다.

분석 방법 (비교 기준: **local master** = 분기점):
- `git merge-base master HEAD`로 공통 조상 확인 (local master 브랜치가 없으면 `git merge-base HEAD upstream/master` 사용)
- 우리가 수정한 파일: `git log --name-only --format="" <merge-base>..HEAD`
- upstream이 수정한 파일: `git log --name-only --format="" <merge-base>..upstream/master`
- 교집합 파일에 대해 양쪽 변경 내용(`git diff`)을 비교하여 기능적 모순 여부 판단

**기능적 모순 예시**:
- upstream이 우리가 추가한 필드를 제거하거나 rename하는 경우
- upstream이 우리가 수정한 함수의 시그니처를 변경하는 경우
- upstream이 우리가 의존하는 동작을 다르게 구현하는 경우
- upstream이 우리가 추가한 타입/상수와 같은 이름으로 다른 것을 추가한 경우

모순이 발견되면:
1. 어떤 파일에서 어떤 모순이 발생하는지 **구체적으로 설명**
2. 우리 변경과 upstream 변경의 의도를 각각 설명
3. 가능한 해결 방안 제시 (우리 변경 유지 / upstream 채택 / 양쪽 통합)
4. **반드시 사용자 확인을 받은 후** 다음 단계로 진행

### 6. 충돌 사전 체크

- `git merge --no-commit --no-ff upstream/master`로 시험 머지 실행.
- 결과 확인 후 반드시 `git merge --abort`로 롤백.
- 충돌이 없으면 "충돌 없음, 안전하게 머지 가능" 출력.
- 충돌 파일이 있으면 목록과 해결 방향을 안내하고 사용자에게 진행 여부 확인.

### 7. 머지 실행

- 사용자에게 머지 진행 확인을 받은 후 실행.
- `git merge upstream/master --no-edit` 실행.
- 충돌 발생 시:
  - 충돌 파일 목록 출력
  - `pnpm-lock.yaml` 충돌은 upstream 채택 후 `pnpm install`로 재생성
  - 기타 파일은 양쪽 변경을 모두 유지하는 방향으로 해결
- 충돌 해결 후 `git add` + `git commit --no-edit`로 머지 완료.

### 8. 결과 요약

- 머지된 커밋 수, 변경된 파일 수 출력 (`git diff --stat ORIG_HEAD`).
- `pnpm install`로 의존성 재설치.
- `pnpm build`로 빌드 검증.
- **local master 브랜치 업데이트**: `git branch -f master upstream/master`
  (다음 백머지 시 정확한 비교 기준을 유지하기 위해)
