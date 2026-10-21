/* LicenseHub 라이선스 사용 가이드 — 발급받은 인증서(라이선스)의 개념과,
   응용 앱에서 실제 사용하는 흐름을 설명한다. 다이어그램은 인라인 SVG. */

function Arrow() {
  return (
    <svg className="dg-arrow" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M0 0l8 4-8 4z" />
    </svg>
  )
}

function KeyChip({ k, tag, who, note, tone }: { k: string; tag: string; who: string; note: string; tone?: 'accent' | 'ok' | 'warn' }) {
  return (
    <div className={`keychip ${tone ?? ''}`}>
      <div className="kc-top">
        <span className="kc-k mono">{k}</span>
        <span className="kc-tag">{tag}</span>
      </div>
      <div className="kc-who">{who}</div>
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
          LicenseHub는 응용 SW가 <strong>발급받은 라이선스 안에서만</strong> 핵심
          기능을 켜도록 하는 발급·검증 시스템입니다. 관리자는 이 시스템으로 고객에게
          라이선스를 발급하고, 고객의 응용 SW는 발급받은 라이선스 파일로 실행 시
          자격을 증명합니다. 이 문서는 발급받은 라이선스가 무엇이고 어떻게 동작하는지,
          응용 앱에 어떻게 설정해 사용하는지를 설명합니다.
        </p>

        {/* ---------------- 라이선스란 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">1. 라이선스란 무엇인가</h2>
          <p className="para">
            LicenseHub의 라이선스는 <strong>"누가, 어느 제품·버전을, 어떤 등급으로,
            언제까지 쓸 수 있는지"</strong>를 담은 데이터 레코드입니다. 무단 변조·복제를
            막기 위해 LicenseHub의 서명 키로 서명하며, 이 서명이 라이선스의 정당성을
            증명합니다. 고객에게는 이 인증서를 <strong>암호화한 파일</strong>로 전달되고,
            응용 앱은 실행 시 이 파일로 자격을 확인합니다.
          </p>
          <p className="para">
            발급받은 라이선스에는 다음 정보가 담깁니다.
          </p>
          <table className="ledger">
            <thead>
              <tr><th>정보</th><th>의미</th><th>비고</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Application ID</td>
                <td>라이선스가 묶이는 응용 앱의 고유 ID</td>
                <td>앱 공개키에서 파생 (아래 7.4 참조)</td>
              </tr>
              <tr>
                <td>제품 / 버전</td>
                <td>라이선스가 적용되는 제품과 버전</td>
                <td className="mono">MyApp / 1.2.0</td>
              </tr>
              <tr>
                <td>등급</td>
                <td>검증 방식</td>
                <td>L1(오프라인) · L2(온라인)</td>
              </tr>
              <tr>
                <td>소유자</td>
                <td>라이선스를 받은 고객</td>
                <td>계약·고객 식별 정보</td>
              </tr>
              <tr>
                <td>발급 · 만료</td>
                <td>유효 기간</td>
                <td>만료 후에는 자동 비활성</td>
              </tr>
              <tr>
                <td>메타데이터</td>
                <td>추가 바인딩 조건</td>
                <td>제품 ID, 실행 파일 이름 등</td>
              </tr>
              <tr>
                <td>검증 서버 주소</td>
                <td>L2일 때 온라인으로 자격을 확인할 주소</td>
                <td>L2에만 해당</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---------------- 구성 요소 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">2. 라이선스 검증 구성 요소</h2>
          <p className="para">
            발급받은 라이선스를 실제로 사용하는 것은 배포된 응용 SW입니다. 다음 요소가
            함께 동작합니다. (표에서 쓰는 약칭은 편의를 위한 것으로, 설명에 그대로 사용합니다.)
          </p>
          <table className="ledger">
            <thead>
              <tr><th>요소</th><th>약칭</th><th>역할</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>라이선스 파일</td>
                <td className="mono">LIC</td>
                <td>발급받은 인증서를 암호화한 파일. 보통 <span className="mono">.lic.json</span>.</td>
              </tr>
              <tr>
                <td>검증 모듈</td>
                <td className="mono">X (LicenseGuard)</td>
                <td>응용 SW에 함께 배포되는 검증 라이브러리. 라이선스 파일 복호화·서명 검증·자격 확인을 담당.</td>
              </tr>
              <tr>
                <td>핵심 로직</td>
                <td className="mono">Y</td>
                <td>실제로 보호 대상인 앱의 주요 기능. 검증 통과 후에만 활성화.</td>
              </tr>
              <tr>
                <td>응용 프로그램</td>
                <td className="mono">Z</td>
                <td>검증 모듈과 핵심 로직을 포함해 실행되는 최종 제품.</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---------------- 키 관리 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">3. 키 관리 (가장 중요)</h2>
          <p className="para">
            라이선스의 발급·검증은 네 종류의 키로 동작합니다. <strong>누가 보유하고
            어디에 저장되는가</strong>가 곧 보안 경계이므로, 아래 원칙을 지키는 것이
            라이선스 보안의 핵심입니다.
          </p>
          <div className="keys">
            <KeyChip
              k="LH_Pri" tag="LicenseHub 서명 개인키"
              who="보유: LicenseHub 서버 (발급 API)"
              note="저장: 서버 시크릿 스토어. 소스·DB·Git·로그·클라이언트 절대 금지"
              tone="warn"
            />
            <KeyChip
              k="LH_Pub" tag="LicenseHub 검증 공개키"
              who="보유: 검증 모듈(X)에 내장"
              note="정적 분석 회피용으로 분산 저장 → 런타임 재조립, 사용 후 zeroize"
              tone="accent"
            />
            <KeyChip
              k="Z_Pub" tag="응용 공개키"
              who="보유: 발급 시 LicenseHub에 제공"
              note="라이선스를 이 키로 암호화. Application ID = SHA-256(Z_Pub)"
            />
            <KeyChip
              k="Z_Pri" tag="응용 개인키"
              who="보유: 응용 SW (Z)"
              note="OS 보호저장소(TPM/Keychain) 사용, 하드코딩 금지, 사용 후 zeroize"
              tone="ok"
            />
          </div>
          <ul className="bullets">
            <li>
              <strong>LH_Pri (서버):</strong> 발급 시 인증서와 라이선스 파일에 서명합니다.
              서버에만 존재하며, 유출되면 라이선스 위조가 가능하므로 가장 엄격히 보호합니다.
            </li>
            <li>
              <strong>LH_Pub (검증 모듈 내장):</strong> "이 라이선스가 LicenseHub가
              발급한 것이 맞는지"를 확인하는 기준입니다. 검증 모듈 내부에 내장되어
              있어, 누군가 외부에서 다른 공개키를 전달해 검증을 우회할 수 없습니다.
            </li>
            <li>
              <strong>Z_Pub / Z_Pri (응용 앱 키):</strong> 발급 시 앱의 공개키(Z_Pub)를
              LicenseHub에 제공하고, 개인키(Z_Pri)는 앱이 보유합니다. 라이선스 파일은
              오직 해당 앱의 Z_Pri로만 복호화되므로, 다른 앱이 라이선스를 재사용할 수
              없습니다.
            </li>
          </ul>
          <div className="alert">
            <strong>회전(로테이션).</strong> 개인키는 나중에 교체할 수 있어야 합니다.
            서버의 LH_Pri를 교체할 때는 기존에 발급한 라이선스가 계속 검증되도록
            키마다 식별자(key_id)를 붙여 버전을 관리합니다.
          </div>
        </section>

        {/* ---------------- 발급 흐름 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">4. 발급 흐름 — 라이선스가 만들어지는 과정</h2>
          <p className="para">
            발급은 LicenseHub 서버에서만 일어납니다. 응용 앱(또는 고객)은 발급 요청 시
            자신의 공개키 <span className="mono">Z_Pub</span>을 제공하고, 그 대가로 자신에게
            암호화된 <span className="mono">라이선스 파일(LIC)</span>을 받습니다.
          </p>
          <div className="flow">
            <div className="flow-step">
              <div className="fs-num">1</div>
              <div className="fs-body">
                <div className="fs-t">인증서 구성</div>
                <div className="fs-d">제품/버전·Application ID·등급·소유자·만료를 담은 인증서를 만든다.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">2</div>
              <div className="fs-body">
                <div className="fs-t">서명</div>
                <div className="fs-d">LicenseHub 서명 키(LH_Pri)로 인증서에 서명 → 변조·위조가 감지됨.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">3</div>
              <div className="fs-body">
                <div className="fs-t">암호화</div>
                <div className="fs-d">발급 대상 앱 공개키(Z_Pub)로 암호화 → 라이선스 파일(LIC).</div>
              </div>
            </div>
          </div>
          <p className="para">
            전달되는 <span className="mono">라이선스 파일</span>은 평문 인증서가 아니라
            암호문이므로, 전송·저장 중에도 제품·소유자·만료 등의 내용이 밖에서 그대로
            드러나지 않습니다. 이 파일을 받은 응용 앱만 자신의 개인키로 읽을 수 있습니다.
          </p>
        </section>

        {/* ---------------- 검증 흐름 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">5. 검증 흐름 — 응용 앱이 라이선스를 사용하는 방법</h2>
          <p className="para">
            응용 앱은 실행 시 발급받은 라이선스 파일과 자신의 개인키로 자격을 증명한 뒤
            핵심 기능을 켭니다. 이 순서가 곧 "라이선스를 사용하는" 과정입니다.
          </p>
          <div className="flow">
            <div className="flow-step">
              <div className="fs-num">1</div>
              <div className="fs-body">
                <div className="fs-t">복호화</div>
                <div className="fs-d">앱이 자신의 개인키(Z_Pri)로 라이선스 파일을 복호화해 인증서를 회복.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">2</div>
              <div className="fs-body">
                <div className="fs-t">서명 검증</div>
                <div className="fs-d">검증 모듈에 내장된 공개키(LH_Pub)로 인증서 서명이 진짜인지 확인.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">3</div>
              <div className="fs-body">
                <div className="fs-t">자격 대조</div>
                <div className="fs-d">제품/버전·Application ID·실행 환경이 인증서와 일치하는지 확인.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">4</div>
              <div className="fs-body">
                <div className="fs-t">활성화</div>
                <div className="fs-d">전부 일치하면 핵심 기능을 켠다. 하나라도 어긋나면 비활성 유지.</div>
              </div>
            </div>
          </div>
          <p className="para">
            서명 검증은 <strong>검증 모듈에 미리 내장된 공개키</strong>를 사용하므로, 실행
            시 외부에서 공개키를 바꿔치기하는 방식으로는 통하지 않습니다. 만료되었거나
            제품·버전·앱이 인증서와 다르면 자격이 인정되지 않습니다.
          </p>
        </section>

        {/* ---------------- 등급 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">6. 등급 — L1(오프라인) / L2(온라인)</h2>
          <p className="para">
            발급 시 라이선스의 등급을 선택하며, 등급에 따라 검증 방식이 달라집니다.
          </p>
          <table className="ledger">
            <thead>
              <tr><th>등급</th><th>검증 방식</th><th>네트워크</th><th>장애 대응</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">L1</td>
                <td>오프라인 검증 (서명·유효기간·자격 대조)</td>
                <td>불필요</td>
                <td>해당 없음</td>
              </tr>
              <tr>
                <td className="mono">L2</td>
                <td>L1 + 서버 조회 (폐기·블랙리스트 확인)</td>
                <td>필요 (인증서에 서명된 검증 서버 주소)</td>
                <td>서버에 닿지 않으면 비활성 (Fail-Closed)</td>
              </tr>
            </tbody>
          </table>
          <p className="para">
            L1은 네트워크 없이도 라이선스 자체의 서명·유효기간만으로 판정합니다. L2는
            여기에 더해 서버에 접속해 라이선스가 폐기·블랙리스트에 올랐는지 확인하며,
            서버에 연결되지 않으면 안전을 위해 라이선스를 켜지 않습니다.
          </p>
        </section>

        {/* ---------------- 응용앱 통합 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">7. 응용 SW에 라이선스 설정하기</h2>
          <p className="para">
            응용 SW에 검증 모듈(X)을 내장하고, 실행 시 라이선스 파일과 개인키로 검증을
            거친 뒤 핵심 기능을 활성화합니다.
          </p>

          <h3 className="sub">7.1 응용 앱이 준비할 것</h3>
          <ul className="bullets">
            <li><span className="mono">Z_Pri</span> — 발급받은 앱 개인키 (OS 보호저장소에 보관)</li>
            <li><span className="mono">라이선스 파일(LIC)</span> — 발급받은 암호화 인증서 (<span className="mono">.lic.json</span>)</li>
            <li><span className="mono">검증 모듈(X)</span> — LicenseGuard 라이브러리 (C ABI: <span className="mono">licensehub_core</span>)</li>
          </ul>

          <h3 className="sub">7.2 실행 시 검증 (C ABI)</h3>
          <Code>{`/* 앱 시작 시: 라이선스 파일 + 개인키로 검증 후 결과 코드 확인 */
uint32_t code = 0;
int32_t rc = lh_decrypt_verify_trusted_license(
    lic_bytes, lic_len,        /* 발급받은 라이선스 파일 (.lic.json) */
    z_pri, z_pri_len,          /* 앱 개인키 Z_Pri (OS 보호저장소에서 읽기) */
    ctx, ctx_len,              /* 실행 컨텍스트 (제품/버전/호스트) */
    &code);

/* code가 LH_VALID(0)일 때만 핵심 기능을 켠다 */
if (rc == 0 && code == LH_VALID) {
    enable_core_logic();       /* 핵심 로직 활성화 */
} else {
    /* 실패: 만료, 서명 오류, 제품/호스트 불일치 등 → 거부 */
    disable_core_logic();
}`}</Code>

          <h3 className="sub">7.3 실행 컨텍스트 (자격 대조 값)</h3>
          <p className="para">
            검증에 넘기는 컨텍스트는 발급된 인증서와 일치해야 합니다. 특히 실행 환경에
            묶이는 값은 빌드해도 변하지 않는 자연스러운 식별값을 사용합니다.
          </p>
          <table className="ledger">
            <thead>
              <tr><th>필드</th><th>의미</th><th>설정 값</th></tr>
            </thead>
            <tbody>
              <tr><td className="mono">product / version</td><td>제품명·버전</td><td>인증서에 서명된 값과 동일</td></tr>
              <tr><td className="mono">product_id</td><td>프로젝트 고유값</td><td>발급 시 서명된 값과 동일</td></tr>
              <tr><td className="mono">executable_name</td><td>실행 파일 이름</td><td><span className="mono">host_executable_name()</span> 자동 조회 권장</td></tr>
              <tr><td className="mono">host_module</td><td>코어 모듈 이름</td><td><span className="mono">host_module_name()</span> 자동 조회 권장</td></tr>
              <tr><td className="mono">server_status</td><td>L2 서버 판정</td><td>L2는 온라인 조회 결과를 주입 (Fail-Closed)</td></tr>
            </tbody>
          </table>

          <h3 className="sub">7.4 Application ID</h3>
          <p className="para">
            Application ID는 임의 문자열이 아니라 <span className="mono">SHA-256(앱 공개키 Z_Pub)</span>에서
            파생됩니다. 이렇게 하면 공개된 ID 자체가 특정 앱 키에 결합하여, 다른 앱이
            같은 ID를 우겨도 복호화·서명 검증이 막힙니다.
          </p>
          <Code>{`/* C: 앱 공개키로부터 Application ID 파생 */
uint8_t app_id[80];
lh_application_id(z_pub, z_pub_len, app_id, sizeof app_id);
/* → URL-safe Base64, SHA-256(Z_Pub) */`}</Code>
        </section>

        {/* ---------------- 보안 지침 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">8. 보안 지침</h2>
          <div className="guide-grid">
            <div className="alert ok">
              <strong>지켜야 할 것</strong>
              <ul className="bullets">
                <li>LH_Pri는 서버에만 (시크릿 스토어)</li>
                <li>Z_Pri는 OS 보호저장소(TPM/Keychain), 사용 후 zeroize</li>
                <li>검증 공개키는 검증 모듈에 내장, 외부 전달 값으로 대체 금지</li>
                <li>라이선스는 원문 암호문으로 배포 (Base64는 암호화가 아님)</li>
                <li>키 교체 시 key_id로 버전 관리</li>
              </ul>
            </div>
            <div className="alert bad">
              <strong>하면 안 될 것</strong>
              <ul className="bullets">
                <li>소스 코드·DB·Git·로그에 개인키 저장</li>
                <li>응용 SW에 서버 자격증명(GitHub 키 등) 포함</li>
                <li>검증 인자로 공개키를 외부에서 전달받아 사용</li>
                <li>검증 결과를 단순히 무시하고 기능을 여는 구조</li>
                <li>L2 라이선스를 네트워크 없이도 켜두기 (Fail-Closed 위반)</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
