# LG Smart 웹폰트

`styles.css`의 `@font-face`가 참조하는 폰트 파일을 이 디렉터리에 배치한다.

| 파일 | 용도 |
|---|---|
| `LGSmart-Regular.otf` | 본문/UI (font-weight 400) |
| `LGSmart-Bold.otf` | 제목 (font-weight 700) |

- LG 스마트체 파일은 LG 공식 배포 자료 또는 정품 파일을 준비한다.
- 파일이 없으면 브라우저는 다음 대체 폰트(LG Smart → 시스템 산스)로 폴백된다.
- 파일을 넣은 뒤 `npm run build` 또는 Pages 재배포로 반영된다.