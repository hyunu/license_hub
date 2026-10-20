/* LicenseHub 시스템 가이드 — 발급·검증 운용, 키·인증서 관리, 응용앱 통합을
   한 페이지에 정리한다. 다이어그램은 인라인 SVG로 그린다. */

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
        <h1 className="title">시스템 가이드</h1>
      </header>

      <div className="content">
        <p className="lead">
          LicenseHub는 응용 SW가 발급받은 라이선스로만 핵심 기능을 열 수 있게 하는
          발급·검증 시스템입니다. 이 문서는 시스템이 어떻게 운용되는지, 발급된
          인증서와 키가 어떻게 관리되어야 하는지, 응용앱에 어떻게 통합하는지를
          개괄합니다.
        </p>

        {/* ---------------- 개요 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">1. 구성 요소</h2>
          <p className="para">
            요구사항 이미지의 기호(P·X·Y·Z)를 그대로 사용합니다. 배포되는 것은
            응용 프로그램 <strong>Z</strong>이며, 그 안에 검증 모듈 <strong>X</strong>와
            보호 대상인 핵심 로직 <strong>Y</strong>가 들어갑니다.
          </p>
          <table className="ledger">
            <thead>
              <tr><th>기호</th><th>이름</th><th>역할</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">P</td>
                <td>License Payload</td>
                <td>Application ID, 제품/버전, 등급(L1/L2), 소유자, 만료, 메타데이터를 담은 라이선스 원문</td>
              </tr>
              <tr>
                <td className="mono">X</td>
                <td>LicenseGuard (검증 모듈)</td>
                <td>응용 SW에 함께 배포되는 검증 라이브러리. LIC 복호화·서명 검증·Application 검증 수행</td>
              </tr>
              <tr>
                <td className="mono">Y</td>
                <td>핵심 로직</td>
                <td>실제 보호 대상. X의 검증 통과 후에만 활성화</td>
              </tr>
              <tr>
                <td className="mono">Z</td>
                <td>응용 프로그램</td>
                <td>X와 Y를 포함해 실행되는 최종 제품</td>
              </tr>
              <tr>
                <td className="mono">LIC</td>
                <td>License (암호화 라이선스)</td>
                <td>P를 LH_Pri로 서명한 뒤 Z_Pub으로 암호화한 배포 파일</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---------------- 키 관리 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">2. 키 관리 (가장 중요)</h2>
          <p className="para">
            시스템은 네 종류의 키로 동작합니다. <strong>누가 보유하고 어디에
            저장되는가</strong>가 곧 보안 경계입니다.
          </p>
          <div className="keys">
            <KeyChip
              k="LH_Pri" tag="LK1 · LicenseHub 서명 개인키"
              who="보유: LicenseHub 서버 (발급 API)"
              note="저장: 서버 환경변수/시크릿 스토어. 소스·DB·Git·로그·클라이언트 절대 금지"
              tone="warn"
            />
            <KeyChip
              k="LH_Pub" tag="LK2 · LicenseHub 검증 공개키"
              who="보유: X (LicenseGuard)에 내장"
              note="정적 분석 회피용으로 분산 저장 → 런타임 재조립, 사용 후 zeroize"
              tone="accent"
            />
            <KeyChip
              k="Z_Pub" tag="AK2 · 응용 공개키"
              who="보유: 발급 시 LicenseHub에 제공"
              note="LIC를 이 키로 암호화. Application ID = SHA-256(Z_Pub)"
            />
            <KeyChip
              k="Z_Pri" tag="AK1 · 응용 개인키"
              who="보유: 응용 SW (Z)"
              note="OS 보호저장소(TPM/Keychain) 사용, 하드코딩 금지, 사용 후 zeroize"
              tone="ok"
            />
          </div>
          <ul className="bullets">
            <li>
              <strong>LH_Pri (서버):</strong> P와 LIC 엔벨로프에 서명합니다.
              서버에만 존재하며 유출되면 라이선스 위조가 가능하므로 가장 엄격히
              보호합니다.
            </li>
            <li>
              <strong>LH_Pub (X 내장):</strong> 검증 모듈이 자신의 서명을 확인하는
              기준입니다. 앱이 외부에서 전달한 공개키로 검증하지 않도록 X 내부에
              내장하며, 정적 분석이 바로 키를 읽지 못하도록 분산·재조립·zeroize를
              적용합니다.
            </li>
            <li>
              <strong>Z_Pri / Z_Pub (앱 키):</strong> 발급 시 Z_Pub을 LicenseHub에
              주고, 개인키 Z_Pri는 앱이 보유합니다. LIC는 오직 해당 앱의 Z_Pri로만
              복호화됩니다. 앱 간 라이선스 재사용이 암호학적으로 차단됩니다.
            </li>
          </ul>
          <div className="alert">
            <strong>관리 원칙.</strong> LH_Pri는 서버에만, LH_Pub은 X에만,
            Z_Pri는 대상 앱에만 존재해야 합니다. 개인키는 교체(회전) 가능해야
            하며, 교체 시 서버의 LH_Pri는 기존 발급분과 호환되도록 key_id로
            버전을 관리합니다.
          </div>
        </section>

        {/* ---------------- 발급 흐름 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">3. 발급 흐름</h2>
          <p className="para">
            발급은 LicenseHub 서버에서만 일어납니다. 응용 SW는 발급 요청 시
            자신의 공개키 <span className="mono">Z_Pub</span>을 제공하고, 그 대가로
            자신에게 암호화된 <span className="mono">LIC</span>를 받습니다.
          </p>
          <div className="flow">
            <div className="flow-step">
              <div className="fs-num">1</div>
              <div className="fs-body">
                <div className="fs-t">Payload 구성</div>
                <div className="fs-d">제품/버전·Application ID·등급·소유자·만료를 담은 P를 만든다.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">2</div>
              <div className="fs-body">
                <div className="fs-t">LH_Pri로 서명</div>
                <div className="fs-d">서버의 서명 키로 P에 서명 → 변조·위조가 감지되는 인증서.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">3</div>
              <div className="fs-body">
                <div className="fs-t">Z_Pub으로 암호화</div>
                <div className="fs-d">X25519 ECDH + AES-256-GCM으로 암호화하고 엔벨로프를 다시 서명 → LIC.</div>
              </div>
            </div>
          </div>
          <p className="para">
            발급 결과물 <span className="mono">LIC</span>는 원문이 아니라 암호문
            ciphertext입니다. 전송·저장 중에 P의 내용(Application ID, 소유자,
            만료 등)이 그대로 드러나지 않습니다.
          </p>
        </section>

        {/* ---------------- 검증 흐름 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">4. 검증 흐름 (응용 SW 실행 시)</h2>
          <div className="flow">
            <div className="flow-step">
              <div className="fs-num">1</div>
              <div className="fs-body">
                <div className="fs-t">LIC 복호화</div>
                <div className="fs-d">앱은 Z_Pri로 LIC를 복호화해 원문 인증서 P를 회복한다.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">2</div>
              <div className="fs-body">
                <div className="fs-t">LH_Pub 서명 검증</div>
                <div className="fs-d">X에 내장된 LH_Pub(LK2)으로 P의 서명을 검증한다.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">3</div>
              <div className="fs-body">
                <div className="fs-t">바인딩 대조</div>
                <div className="fs-d">제품/버전·Application ID·실행 환경(호스트)이 일치하는지 확인.</div>
              </div>
            </div>
            <Arrow />
            <div className="flow-step">
              <div className="fs-num">4</div>
              <div className="fs-body">
                <div className="fs-t">Y 활성화</div>
                <div className="fs-d">전부 통과하면 핵심 로직(Y)을 켠다. 하나라도 실패하면 비활성.</div>
              </div>
            </div>
          </div>
          <p className="para">
            검증은 <strong>내장된 LK2</strong>를 사용하므로, 앱이 검증 인자로
            공개키를 넘겨 위조하는 공격은 통하지 않습니다. L2 등급은 여기에
            서버 조회(재voke·블랙리스트 확인)를 추가하며, 서버에 닿지 않으면
            기본적으로 비활성화됩니다(Fail-Closed).
          </p>
        </section>

        {/* ---------------- 등급 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">5. 등급 L1 / L2</h2>
          <table className="ledger">
            <thead>
              <tr><th>등급</th><th>검증 방식</th><th>네트워크</th><th>Fail-Closed</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">L1</td>
                <td>오프라인 검증 (서명·유효기간·바인딩)</td>
                <td>불필요</td>
                <td>해당 없음</td>
              </tr>
              <tr>
                <td className="mono">L2</td>
                <td>L1 + 서버 조회 (재voke/블랙리스트)</td>
                <td>필요 (인증서에 서명된 verification_url)</td>
                <td>서버 미도달 시 비활성</td>
              </tr>
            </tbody>
          </table>
          <p className="para muted small">
            등급은 1~2까지만 제공합니다. 기기 식별값(L3)은 OS·환경에 따라 얻는
            방법이 달라 검증이 일관되지 않아 제외되었습니다.
          </p>
        </section>

        {/* ---------------- 응용앱 통합 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">6. 응용 SW 통합 설정</h2>
          <p className="para">
            응용 SW에 LicenseGuard(X)를 내장하고, 실행 시 LIC와 Z_Pri로 검증을
            거친 뒤 핵심 로직을 활성화합니다.
          </p>

          <h3 className="sub">6.1 응용 앱이 보유해야 할 것</h3>
          <ul className="bullets">
            <li><span className="mono">Z_Pri</span> — 발급받은 앱 개인키 (OS 보호저장소에 보관)</li>
            <li><span className="mono">LIC</span> — 발급받은 암호화 라이선스 파일 (.lic.json)</li>
            <li><span className="mono">X</span> — LicenseGuard 라이브러리 (C ABI: <span className="mono">licensehub_core</span>)</li>
          </ul>

          <h3 className="sub">6.2 실행 시 검증 (C ABI)</h3>
          <Code>{`/* 앱 시작 시: LIC + Z_Pri로 검증 후 결과 코드를 확인 */
uint32_t code = 0;
int32_t rc = lh_decrypt_verify_trusted_license(
    lic_bytes, lic_len,        /* 발급받은 LIC (.lic.json) */
    z_pri, z_pri_len,          /* 앱 개인키 Z_Pri (OS 보호저장소에서 읽기) */
    ctx, ctx_len,              /* 실행 컨텍스트 (제품/버전/호스트) */
    &code);

/* code가 LH_VALID(0)일 때만 핵심 로직(Y)을 켠다 */
if (rc == 0 && code == LH_VALID) {
    enable_core_logic();       /* Y 활성화 */
} else {
    /* 실패: 만료(6), 서명 오류(4), 호스트 불일치(14), ... 거부 */
    disable_core_logic();
}`}</Code>

          <h3 className="sub">6.3 실행 컨텍스트 (바인딩)</h3>
          <p className="para">
            검증 컨텍스트는 발급된 인증서와 일치해야 합니다. 특히 호스트 바인딩은
            리빌드해도 변하지 않는 값으로 설정합니다.
          </p>
          <table className="ledger">
            <thead>
              <tr><th>필드</th><th>의미</th><th>설정 값</th></tr>
            </thead>
            <tbody>
              <tr><td className="mono">product / version</td><td>제품명·버전</td><td>인증서에 서명된 값과 동일</td></tr>
              <tr><td className="mono">product_id</td><td>프로젝트 고유값(GUID 등)</td><td>발급 시 서명된 값과 동일</td></tr>
              <tr><td className="mono">executable_name</td><td>실행 파일 이름</td><td><span className="mono">host_executable_name()</span> 자동 조회 권장</td></tr>
              <tr><td className="mono">host_module</td><td>코어 모듈 이름</td><td><span className="mono">host_module_name()</span> 자동 조회 권장</td></tr>
              <tr><td className="mono">server_status</td><td>L2 서버 판정</td><td>L2는 온라인 조회 결과 주입 (Fail-Closed)</td></tr>
            </tbody>
          </table>

          <h3 className="sub">6.4 Application ID</h3>
          <p className="para">
            Application ID는 임의 문자열이 아니라 <span className="mono">SHA-256(Z_Pub)</span>에서
            파생됩니다. 이렇게 하면 공개된 ID 자체가 특정 앱 키에 결합하여,
            다른 앱이 같은 ID를 우겨도 복호화·서명 검증이 막힙니다.
          </p>
          <Code>{`/* C: 앱 공개키로부터 Application ID 파생 */
uint8_t app_id[80];
lh_application_id(z_pub, z_pub_len, app_id, sizeof app_id);
/* → URL-safe Base64, SHA-256(Z_Pub) */`}</Code>
        </section>

        {/* ---------------- 보안 지침 ---------------- */}
        <section className="sec">
          <h2 className="sec-title">7. 보안 지침</h2>
          <div className="guide-grid">
            <div className="alert ok">
              <strong>지켜야 할 것</strong>
              <ul className="bullets">
                <li>LH_Pri는 서버에만 (환경변수/시크릿 스토어)</li>
                <li>Z_Pri는 OS 보호저장소(TPM/Keychain), 사용 후 zeroize</li>
                <li>LK2는 X에 분산 내장, 외부 전달 키로 대체 금지</li>
                <li>LIC는 원문 암호문으로 배포 (Base64는 암호화 아님)</li>
                <li>키 회전 시 key_id로 버전 관리</li>
              </ul>
            </div>
            <div className="alert bad">
              <strong>하면 안 될 것</strong>
              <ul className="bullets">
                <li>소스 코드·DB·Git·로그에 개인키 저장</li>
                <li>클라이언트(C/X)에 GitHub 자격증명 포함</li>
                <li>검증 인자로 공개키를 외부에서 전달받아 사용</li>
                <li><span className="mono">if (LicenseValid()) return TRUE;</span> 단순 패치 취약 구조</li>
                <li>L2를 오프라인에서도 켜두기 (Fail-Closed 위반)</li>
              </ul>
            </div>
          </div>
        </section>

        <p className="muted small doc-end">
          상세 설계는 저장소 <span className="mono">docs/CORE_DESIGN.md</span>·
          <span className="mono">docs/REQUIREMENTS.md</span> 참조.
        </p>
      </div>
    </div>
  )
}
