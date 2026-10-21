/* LicenseHub 라이선스 사용 가이드 — 발급받은 인증서(라이선스)의 개념과,
   응용 앱에서 실제 사용하는 흐름을 설명한다. 절차는 인라인 SVG 다이어그램으로 나타낸다.
   본문 개행은 문장 단위로만 하고, 약어 대신 풀네임을 사용한다. */

function Arrow() {
  return (
    <svg className="dg-arrow" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M0 0l8 4-8 4z" />
    </svg>
  )
}

/* 인증서 발급 절차: 발급 요청 → 서버에서 인증서 구성·서명·암호화 → 라이선스 파일 → 응용 프로그램 전달 */
function IssueDiagram() {
  return (
    <svg viewBox="0 0 900 200" className="dg" role="img" aria-label="인증서 발급 절차">
      <defs>
        <marker id="iarr" markerWidth="9" markerHeight="9" refX="7.2" refY="3.2" orient="auto">
          <path d="M0 0l7.2 3.2L0 6.4z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* 발급 요청(입력) */}
      <rect x="4" y="50" width="132" height="92" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="70" y="72" textAnchor="middle" className="dg-t">발급 요청</text>
      <text x="70" y="94" textAnchor="middle" className="dg-s">제품·버전·등급</text>
      <text x="70" y="110" textAnchor="middle" className="dg-s">소유자·만료</text>
      <text x="70" y="128" textAnchor="middle" className="dg-s">응용 공개키</text>

      <line x1="136" y1="96" x2="172" y2="96" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#iarr)" />

      {/* 발급 서버 (파이프라인) */}
      <rect x="174" y="24" width="430" height="148" rx="3" fill="none" stroke="var(--line-strong)" strokeDasharray="5 4" />
      <text x="182" y="18" className="dg-band">LicenseHub 발급 서버</text>

      <rect x="188" y="60" width="112" height="76" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="244" y="90" textAnchor="middle" className="dg-t">인증서 구성</text>
      <text x="244" y="110" textAnchor="middle" className="dg-s">자격 정보 작성</text>

      <line x1="300" y1="98" x2="316" y2="98" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#iarr)" />

      <rect x="318" y="60" width="112" height="76" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
      <text x="374" y="88" textAnchor="middle" className="dg-t">서명</text>
      <text x="374" y="108" textAnchor="middle" className="dg-l">서명 개인키</text>

      <line x1="430" y1="98" x2="446" y2="98" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#iarr)" />

      <rect x="448" y="60" width="140" height="76" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
      <text x="518" y="88" textAnchor="middle" className="dg-t">암호화</text>
      <text x="518" y="108" textAnchor="middle" className="dg-l">응용 공개키</text>

      <line x1="604" y1="96" x2="640" y2="96" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#iarr)" />

      {/* 산출물: 라이선스 파일 */}
      <rect x="642" y="50" width="128" height="92" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="706" y="84" textAnchor="middle" className="dg-t">라이선스 파일</text>
      <text x="706" y="104" textAnchor="middle" className="dg-s">.lic.json</text>
      <text x="706" y="122" textAnchor="middle" className="dg-s">(암호문)</text>

      <line x1="770" y1="96" x2="792" y2="96" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#iarr)" />
      <text x="781" y="86" textAnchor="middle" className="dg-s">전달</text>

      {/* 수신: 응용 프로그램 */}
      <rect x="794" y="64" width="102" height="64" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="845" y="92" textAnchor="middle" className="dg-t">응용 프로그램</text>
      <text x="845" y="112" textAnchor="middle" className="dg-s">개인키로 열기</text>
    </svg>
  )
}

/* 라이선스 검증 절차: 라이선스 파일과 개인키 → 복호화 → 서명 검증 → 자격 대조 → 핵심 기능 활성화 */
function VerifyDiagram() {
  return (
    <svg viewBox="0 0 900 196" className="dg" role="img" aria-label="라이선스 검증 절차">
      <defs>
        <marker id="varr" markerWidth="9" markerHeight="9" refX="7.2" refY="3.2" orient="auto">
          <path d="M0 0l7.2 3.2L0 6.4z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* 입력: 라이선스 파일 */}
      <rect x="4" y="26" width="132" height="58" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="70" y="51" textAnchor="middle" className="dg-t">라이선스 파일</text>
      <text x="70" y="70" textAnchor="middle" className="dg-s">.lic.json</text>

      {/* 입력: 응용 개인키 */}
      <rect x="4" y="112" width="132" height="58" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="70" y="137" textAnchor="middle" className="dg-t">응용 개인키</text>
      <text x="70" y="156" textAnchor="middle" className="dg-s">보호 저장소</text>

      {/* 두 입력이 복호화로 합류 */}
      <line x1="136" y1="55" x2="174" y2="86" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#varr)" />
      <line x1="136" y1="141" x2="174" y2="110" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#varr)" />

      <rect x="176" y="66" width="124" height="64" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
      <text x="238" y="93" textAnchor="middle" className="dg-t">복호화</text>
      <text x="238" y="113" textAnchor="middle" className="dg-l">개인키</text>

      <line x1="300" y1="98" x2="328" y2="98" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#varr)" />

      <rect x="330" y="66" width="148" height="64" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
      <text x="404" y="93" textAnchor="middle" className="dg-t">서명 검증</text>
      <text x="404" y="113" textAnchor="middle" className="dg-l">내장 검증 공개키</text>

      <line x1="478" y1="98" x2="506" y2="98" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#varr)" />

      <rect x="508" y="66" width="140" height="64" rx="2" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="578" y="93" textAnchor="middle" className="dg-t">자격 대조</text>
      <text x="578" y="113" textAnchor="middle" className="dg-s">제품·버전·앱·서버</text>

      <line x1="648" y1="98" x2="676" y2="98" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#varr)" />

      <rect x="678" y="66" width="180" height="64" rx="2" fill="var(--panel)" stroke="var(--ok)" />
      <text x="768" y="93" textAnchor="middle" className="dg-t">핵심 기능 활성화</text>
      <text x="768" y="113" textAnchor="middle" className="dg-s">모두 일치할 때만</text>
    </svg>
  )
}

function KeyChip({ name, code, tag, who, note, tone }: {
  name: string; code: string; tag: string; who: string; note: string; tone?: 'accent' | 'ok' | 'warn'
}) {
  return (
    <div className={`keychip ${tone ?? ''}`}>
      <div className="kc-top">
        <span className="kc-k mono">{name}</span>
        <span className="kc-tag">{tag}</span>
      </div>
      <div className="kc-code mono">{code} · {who}</div>
      <div className="kc-note mono">{note}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return <pre className="code">{children}</pre>
}

export function Guide() {
  return (
    <div className="guide">
      <header className="topbar">
        <h1 className="title">라이선스 사용 가이드</h1>
      </header>

      <div className="content">
        <p className="lead">
          LicenseHub는 응용 소프트웨어가 "정당한 사용자에게 발급된 정품"임을 증명하는
          라이선스 발급·검증 시스템입니다.
          이 가이드는 발급받은 인증서(라이선스)가 무엇인지, 그리고 응용 앱이 그 인증서로
          무엇을 어떻게 확인하는지 설명합니다.
        </p>

        {/* 1. 라이선스란 무엇인가 */}
        <h2 id="what">1. 라이선스, 어떤 파일인가</h2>
        <p>
          라이선스 파일은 발급 기관이 발행한 <strong>인증서</strong>입니다.
          응용 소프트웨어가 특정 제품·버전을 특정 자에게, 일정 기간, 특정 조건으로
          사용할 자격이 있음을 담고 있습니다.
        </p>
        <p>
          이 인증서는 암호문으로 저장됩니다.
          발급 기관의 전용 키로 서명하고, 대상 응용 앱의 공개키로 암호화했기 때문에
          서명 기관과 내용이 바뀌었는지, 그리고 열어볼 자격이 있는지를 동시에 증명합니다.
        </p>
        <p>
          파일 안에는 다음 항목이 담깁니다.
        </p>
        <div className="chips">
          <span className="chip">제품군 · 제품 · 버전</span>
          <span className="chip">암호키 식별자</span>
          <span className="chip">발급 만료 시각 (UTC)</span>
          <span className="chip">모듈 및 실행 파일 제한</span>
          <span className="chip">소유자 정보</span>
          <span className="chip">서버 검증 상태</span>
          <span className="chip">허용 등급 (오프라인·온라인)</span>
        </div>

        <div className="callout">
          <div className="callout-h">요약</div>
          <p>
            라이선스는 열쇠가 아니라 <strong>인증서</strong>입니다.
            권한을 스스로 바꾸지 못하도록 암호문으로 보관하고,
            검증 시 그 인증서가 실제로 발급 기관에서 나왔는지 확인합니다.
          </p>
        </div>

        {/* 2. 구성 요소 */}
        <h2 id="parts">2. 라이선스를 이루는 것들</h2>
        <p>
          한 장의 인증서가 동작하려면 네 가지가 맞물려야 합니다.
        </p>
        <table className="tbl">
          <thead>
            <tr><th>요소</th><th>역할</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>라이선스 파일</strong></td>
              <td>
                발급받은 인증서를 담은 파일로, 보통 <span className="mono">.lic.json</span> 이름을 사용합니다.
                암호문 상태라 사람이 읽어도 내용을 알 수 없습니다.
              </td>
            </tr>
            <tr>
              <td><strong>검증 모듈</strong> (LicenseGuard)</td>
              <td>
                응용 프로그램에 함께 배포되는 검증 라이브러리입니다.
                라이선스를 열고, 서명을 확인하고, 자격을 대조한 뒤
                핵심 기능을 켜거나 끕니다.
              </td>
            </tr>
            <tr>
              <td><strong>핵심 로직</strong></td>
              <td>
                보호받는 응용 프로그램의 기능입니다.
                검증이 끝날 때까지 꺼져 있고, 검증 모듈이 참조를 넘길 때만 실행됩니다.
              </td>
            </tr>
            <tr>
              <td><strong>응용 프로그램</strong></td>
              <td>
                최종 사용자가 쓰는 응용 프로그램입니다.
                발급받은 라이선스 파일과 개인키를 가지고, 실행 시 검증을 요청합니다.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          관계를 한 줄로 보면 이렇습니다.
          응용 프로그램은 발급받은 인증서를 검증 모듈에 건네고,
          검증 모듈은 그 인증서가 정당한지 확인한 뒤에만 핵심 로직을 켭니다.
        </p>

        {/* 3. 키 구성 */}
        <h2 id="keys">3. 네 개의 키</h2>
        <p>
          발급과 검증은 네 개의 키로 이루어집니다.
          개인키는 절대 밖으로 나가지 않고, 공개키만 상대에게 전달됩니다.
        </p>

        <div className="keys">
          <KeyChip
            name="LicenseHub 서명 개인키" code="LH_Pri" tag="서버 전용"
            who="보유: 발급 서버" note="인증서에 서명하는 유일한 키. 외부 반출 금지."
            tone="warn"
          />
          <KeyChip
            name="LicenseHub 검증 공개키" code="LH_Pub" tag="모듈 내장"
            who="보유: 검증 모듈" note="서명 검증용. 모듈 안에 분산 내장, 사용 후 즉시 삭제."
            tone="accent"
          />
          <KeyChip
            name="응용 공개키" code="Z_Pub" tag="발급 시 제공"
            who="보유: 응용 프로그램" note="라이선스를 이 키로 암호화. 애플리케이션 식별자도 여기서 파생."
            tone="ok"
          />
          <KeyChip
            name="응용 개인키" code="Z_Pri" tag="응용 프로그램 보관"
            who="보유: 응용 프로그램" note="라이선스를 복호화. 운영체제 보호 저장소에 보관, 외부 반출 금지."
            tone="warn"
          />
        </div>

        <table className="tbl">
          <thead>
            <tr><th>키 이름</th><th>공개 범위</th><th>용도</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>서명 개인키</strong></td><td>없음 (서버 내부 한정)</td><td>인증서에 서명</td></tr>
            <tr><td><strong>검증 공개키</strong></td><td>검증 모듈에 내장</td><td>서명 검증</td></tr>
            <tr><td><strong>응용 공개키</strong></td><td>공개 (발급·검증용)</td><td>라이선스 암호화 · 애플리케이션 식별자 파생</td></tr>
            <tr><td><strong>응용 개인키</strong></td><td>없음 (응용 프로그램 보관)</td><td>라이선스 복호화</td></tr>
          </tbody>
        </table>

        <div className="callout warn">
          <div className="callout-h">지켜야 할 규칙</div>
          <p>
            <strong>1)</strong> 개인키는 밖에 내보내지 않습니다.
          </p>
          <p>
            <strong>2)</strong> 서명 개인키는 발급 서버에만 둡니다.
          </p>
          <p>
            <strong>3)</strong> 응용 개인키는 응용 프로그램이 운영체제 보호 저장소에 보관하고,
            검증 모듈에 상주시키지 않습니다.
          </p>
          <p>
            <strong>4)</strong> 검증에 쓰는 공개키는 모듈 안에 넣되,
            필요한 순간에만 복원하고 사용 후 즉시 삭제합니다.
          </p>
        </div>

        {/* 4. 발급 절차 */}
        <h2 id="issue">4. 인증서 발급 절차</h2>
        <p>
          발급은 발급 서버 안에서만 일어납니다.
          아래 다이어그램은 발급 요청이 라이선스 파일이 되기까지의 전체 절차와,
          각 단계에서 어느 키를 쓰는지 보여줍니다.
        </p>

        <IssueDiagram />
        <p className="dg-cap">
          그림 1. 인증서 발급 절차 — 발급 서버가 인증서를 구성해 서명하고, 대상 앱의 공개키로 암호화한 뒤
          라이선스 파일로 전달한다.
        </p>

        <p>
          절차를 단계별로 보면 다음과 같습니다.
        </p>
        <p>
          <strong>① 발급 요청</strong> — 대상 제품과 버전, 허용 등급, 소유자, 만료 시각,
          그리고 그 응용 프로그램의 공개키를 함께 요청합니다.
        </p>
        <p>
          <strong>② 인증서 구성</strong> — 요청받은 자격 정보로 인증서를 작성합니다.
          여기에 키 식별자와 만료 시각이 포함됩니다.
        </p>
        <p>
          <strong>③ 서명</strong> — 발급 서버의 서명 개인키로 인증서에 서명합니다.
          이 단계 덕분에 나중에 "정말 이 기관이 발행한 것인지"를 확인할 수 있습니다.
        </p>
        <p>
          <strong>④ 암호화</strong> — 서명된 인증서를 대상 응용 프로그램의 공개키로 암호화합니다.
          공개키로 감싸기 때문에 그 공개키에 상응하는 개인키를 가진 응용 프로그램만 열 수 있습니다.
        </p>
        <p>
          <strong>⑤ 전달</strong> — 암호화된 라이선스 파일을 응용 프로그램에 전달합니다.
          서명과 암호화를 거쳤으므로, 전달 경로를 염려할 필요 없이 그대로 두면 됩니다.
        </p>

        <div className="callout">
          <div className="callout-h">왜 서명과 암호화를 둘 다 하나</div>
          <p>
            서명만 하면 내용이 유출되고, 암호화만 하면 발급 주체를 증명할 수 없습니다.
            서명으로 <strong>정당한 발급</strong>을, 암호화로 <strong>열 자격</strong>을 함께 보장합니다.
          </p>
        </div>

        {/* 5. 검증 절차 */}
        <h2 id="verify">5. 응용 프로그램이 확인하는 것</h2>
        <p>
          응용 프로그램이 실행되면 검증 모듈이 발급받은 인증서를 검사합니다.
          아래 다이어그램은 검증이 순서대로 어떻게 진행되는지 보여줍니다.
        </p>

        <VerifyDiagram />
        <p className="dg-cap">
          그림 2. 라이선스 검증 절차 — 복호화, 서명 검증, 자격 대조를 차례로 통과해야 핵심 기능이 켜진다.
        </p>

        <p>
          각 단계에서 확인하는 것은 다음과 같습니다.
        </p>
        <p>
          <strong>1. 복호화</strong> — 응용 프로그램은 자신의 개인키로 라이선스를 엽니다.
          개인키가 없으면 암호문 자체를 풀 수 없으므로, 남이 가져가 봐야 읽지 못합니다.
        </p>
        <p>
          <strong>2. 서명 검증</strong> — 검증 모듈에 내장된 발급 기관 공개키로
          서명이 올바른지 확인합니다.
          발급 기관이 아닌 누군가 내용을 고쳤다면 이 단계에서 걸러집니다.
        </p>
        <p>
          <strong>3. 자격 대조</strong> — 열어낸 인증서의 조건이 현재 환경과 맞는지 확인합니다.
          제품과 버전, 실행 파일, 그리고 발급 시 설정한 서버 검증 상태를 대조합니다.
        </p>
        <p>
          세 단계를 모두 통과하면 핵심 로직이 활성화됩니다.
          하나라도 실패하면 참조를 넘기지 않아 기능이 꺼진 채로 유지됩니다.
        </p>

        <div className="callout ok">
          <div className="callout-h">핵심</div>
          <p>
            검증은 <strong>인증서가 진짜인지</strong>와 <strong>조건이 충족되는지</strong>를
            순서대로 확인하는 과정입니다.
            둘 중 하나라도 어긋나면 권한을 주지 않습니다.
          </p>
        </div>

        {/* 6. 등급 */}
        <h2 id="level">6. 허용 등급: 오프라인과 온라인</h2>
        <p>
          발급 시 허용 등급을 지정합니다.
          이 등급은 "서버와 연결이 끊기면 어떻게 할지"를 결정합니다.
        </p>
        <table className="tbl">
          <thead>
            <tr><th>등급</th><th>방식</th><th>연결이 끊기면</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>L1</strong> · 오프라인</td>
              <td>로컬 검증만으로 통과</td>
              <td>네트워크가 없어도 계속 사용 가능</td>
            </tr>
            <tr>
              <td><strong>L2</strong> · 온라인</td>
              <td>서버 상태 확인 필수</td>
              <td>서버에 연결되지 않으면 비활성 (연결 실패 시 비활성)</td>
            </tr>
          </tbody>
        </table>
        <p>
          서버 검증 상태를 켠 라이선스(L2)는, 서버가 응답하지 않으면 권한을 유지하지 않습니다.
          안전을 우선하는 서버 제품에는 이 방식을 씁니다.
        </p>

        {/* 7. 통합 */}
        <h2 id="integrate">7. 응용 프로그램에 붙이기</h2>
        <p>
          응용 프로그램은 발급받은 라이선스 파일과 개인키, 그리고 보호할 핵심 로직만 준비하면 됩니다.
          검증 모듈은 응용 프로그램 안에서 인증서를 열고, 서명을 확인하고, 자격을 대조합니다.
        </p>

        <h3 id="integrate-c">7.1 C 언어 인터페이스로 검증 호출하기</h3>
        <p>
          검증 모듈은 C 언어 인터페이스를 제공합니다.
          인증서와 개인키를 넘기고, 핵심 로직의 참조를 돌려받는 형태입니다.
        </p>
        <Code>{`// 검증 수행: 인증서 + 개인키 → 핵심 로직 참조 (실패 시 NULL)
LH_Library lib = NULL;
LH_Status st = lh_decrypt_verify_trusted_license(
    lic_bytes,   /* 발급받은 라이선스 파일 (암호문 그대로) */
    lic_len,
    z_pri,       /* 응용 개인키 */
    z_pri_len,
    NULL, 0,     /* 추가 컨텍스트 (없으면 생략) */
    &lib);

if (st == LH_VALID && lib != NULL) {
    /* 검증 통과 — 핵심 기능 진입점 활성화 */
    void (*run)(void) = (void (*)(void))lh_symbol(lib, "main_entry");
    if (run) run();

    lh_library_free(lib);   /* 사용 후 해제 */
}`}</Code>

        <h3 id="integrate-ctx">7.2 검증에 쓰이는 컨텍스트</h3>
        <p>
          자격 대조 단계는 응용 프로그램이 넘긴 컨텍스트를 사용합니다.
          인증서에 적힌 조건과 현재 실행 환경을 비교하는 데 필요한 값들입니다.
        </p>
        <table className="tbl">
          <thead>
            <tr><th>필드</th><th>의미</th></tr>
          </thead>
          <tbody>
            <tr><td className="mono">product_id / version</td><td>발급 대상 제품과 버전</td></tr>
            <tr><td className="mono">executable_name</td><td>실행 파일 이름 (격리 검증용)</td></tr>
            <tr><td className="mono">host_module</td><td>핵심 로직이 있는 호스트 모듈 경로</td></tr>
            <tr><td className="mono">server_status</td><td>서버 연결 상태 (온라인 등급일 때 필수)</td></tr>
          </tbody>
        </table>
        <p>
          응용 프로그램은 각 플랫폼에 맞는 값을 채워 넣습니다.
          데스크톱에서는 실행 파일 이름과 호스트 모듈 경로를,
          모바일에서는 번들 식별자를 사용합니다.
        </p>

        <h3 id="integrate-flow">7.3 붙이는 흐름</h3>
        <p>
          응용 프로그램을 새로 붙일 때의 순서는 다음과 같습니다.
        </p>
        <div className="flow">
          <div className="flow-step">
            <div className="fs-num mono">01</div>
            <div className="fs-t">앱 식별 정보 준비</div>
            <div className="fs-d">제품·버전·실행 파일·핵심 모듈 경로를 정하고, 응용 공개키를 만듭니다.</div>
          </div>
          <Arrow />
          <div className="flow-step">
            <div className="fs-num mono">02</div>
            <div className="fs-t">라이선스 발급</div>
            <div className="fs-d">응용 공개키와 조건을 넘겨 라이선스 파일을 발급받습니다.</div>
          </div>
          <Arrow />
          <div className="flow-step">
            <div className="fs-num mono">03</div>
            <div className="fs-t">모듈·개인키 연결</div>
            <div className="fs-d">검증 모듈을 붙이고, 응용 개인키를 운영체제 보호 저장소에 넣습니다.</div>
          </div>
          <Arrow />
          <div className="flow-step">
            <div className="fs-num mono">04</div>
            <div className="fs-t">실행 시 검증</div>
            <div className="fs-d">앱 시작 시 인증서와 개인키를 검증 모듈에 넘기고, 핵심 기능을 검증 뒤에 켭니다.</div>
          </div>
        </div>

        <h3 id="integrate-id">7.4 애플리케이션 식별자</h3>
        <p>
          응용 공개키를 기준으로 고유한 애플리케이션 식별자가 만들어집니다.
          이 식별자는 발급과 검증에서 같은 방식으로 계산되므로,
          응용 프로그램과 발급 기관이 별도로 합의할 필요가 없습니다.
        </p>
        <Code>{`애플리케이션 식별자 = SHA-256(응용 공개키)
   → 발급 시 계산 = 검증 시 계산 (동일)`}</Code>
        <p>
          여러 응용 프로그램이 하나의 발급 기관을 쓰거나,
          한 응용 프로그램이 여러 환경에서 실행되더라도 각각 다른 식별자가 나옵니다.
        </p>

        {/* 8. 보안 유의사항 */}
        <h2 id="security">8. 보안에서 유의할 점</h2>

        <table className="tbl dont">
          <thead>
            <tr><th>하면 안 되는 것</th><th>이유</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>라이선스 파일을 일반 파일로 두고 수정</td>
              <td>암호문이므로 바꿔도 의미가 없고, 서명이 깨져 서명 검증에서 실패합니다.</td>
            </tr>
            <tr>
              <td>검증 결과를 코드에 상수로 박아 두기</td>
              <td>검증 없이 항상 켜진 상태가 되어 인증서를 우회하는 경로를 만듭니다.</td>
            </tr>
            <tr>
              <td>응용 개인키를 설치 파일이나 공개 저장소에 넣기</td>
              <td>그 개인키로 다른 기기에서까지 라이선스를 열 수 있게 됩니다.</td>
            </tr>
            <tr>
              <td>서명 개인키를 개발자 PC나 저장소에 두기</td>
              <td>유출되면 가짜 인증서를 발급할 수 있습니다. 반드시 발급 서버에만 둡니다.</td>
            </tr>
            <tr>
              <td>온라인 등급에서 연결 실패를 통과로 처리하기</td>
              <td>연결 실패 시 비활성이라는 원칙이 무너져 서버가 꺼져 있어도 권한이 유지됩니다.</td>
            </tr>
          </tbody>
        </table>

        <table className="tbl do">
          <thead>
            <tr><th>지켜야 할 것</th><th>이유</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>개인키를 운영체제 보호 저장소에 보관</td>
              <td>접근 주체를 운영체제가 통제해 외부 접근을 줄입니다.</td>
            </tr>
            <tr>
              <td>검증 모듈의 내장 공개키를 분산해 두고, 사용 후 즉시 삭제</td>
              <td>모듈을 분석해도 검증 키를 한 번에 회수하지 못하게 합니다.</td>
            </tr>
            <tr>
              <td>검증에 실패하면 참조를 넘기지 않기</td>
              <td>기본값이 비활성 상태이므로 잘못된 조건에서도 핵심 기능이 켜지지 않습니다.</td>
            </tr>
            <tr>
              <td>발급 서버에 감사 로그 남기기</td>
              <td>누가, 언제, 어떤 조건으로 발급했는지 추적할 수 있습니다.</td>
            </tr>
            <tr>
              <td>라이선스가 만료되면 자동으로 비활성화</td>
              <td>별도 회수 절차 없이도 조건이 끝나면 권한이 사라집니다.</td>
            </tr>
          </tbody>
        </table>

        <div className="callout warn">
          <div className="callout-h">한 줄 정리</div>
          <p>
            개인키는 밖에 내보내지 않고,
            검증에 실패하면 권한을 주지 않으며,
            서버 검증을 켠 라이선스는 연결이 끊기면 비활성화합니다.
          </p>
        </div>

        {/* 9. 용어 */}
        <h2 id="terms">9. 용어 정리</h2>
        <table className="tbl">
          <thead>
            <tr><th>용어</th><th>뜻</th></tr>
          </thead>
          <tbody>
            <tr><td>인증서 · 라이선스 파일</td><td>발급 기관이 발행한 자격 증명. 암호문 상태로 저장됩니다.</td></tr>
            <tr><td>검증 모듈 (LicenseGuard)</td><td>인증서를 열고, 서명을 확인하고, 자격을 대조하는 응용 프로그램의 구성 요소입니다.</td></tr>
            <tr><td>핵심 로직</td><td>보호받는 응용 프로그램의 기능으로, 검증이 끝날 때까지 꺼져 있습니다.</td></tr>
            <tr><td>응용 공개키 · 응용 개인키</td><td>라이선스를 암호화·복호화하는 한 쌍의 키입니다.</td></tr>
            <tr><td>서명 개인키 · 검증 공개키</td><td>발급 기관의 서명과 검증을 위한 한 쌍의 키입니다.</td></tr>
            <tr><td>애플리케이션 식별자</td><td>응용 공개키에서 파생되는 고유 식별자입니다.</td></tr>
            <tr><td>허용 등급</td><td>오프라인(L1)과 온라인(L2)으로, 연결이 끊겼을 때의 동작을 결정합니다.</td></tr>
            <tr><td>연결 실패 시 비활성</td><td>온라인 등급에서 서버에 연결되지 않으면 권한을 유지하지 않는 정책입니다.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
