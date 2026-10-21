"""LicenseGuard — LicenseHub 검증 모듈 Python 바인딩.

Core 의 C ABI 를 ctypes 로 호출한다. 검증만 수행하며 발급·서명 개인키는 다루지 않는다.

운영 경로(암호화 라이선스):
    guard.decrypt_verify_trusted_license(envelope, app_private_key_raw32, context_json)
    guard.decrypt_verify_trusted_license_online(...)   # L2

저수준(인증서 + 공개키):
    guard.verify_certificate(certificate_json, public_key_raw32, context_json)

네이티브 라이브러리는 패키지 내부의 native/<os>-<arch>/ 에 번들된다.
환경변수 LICENSEHUB_CORE_LIB 또는 lib_path 인자로 재정의할 수 있다.
"""

from __future__ import annotations

import ctypes
import os
import pathlib
import platform

__all__ = ["LicenseGuard", "VerificationCode", "VerifyResult", "__version__"]

__version__ = "0.1.0"


class VerificationCode:
    """검증 결과 코드.

    값은 core/include/licensehub_core.h 의 enum lh_verification_code 와
    1:1 로 대응한다. 값을 바꾸면 안 된다.
    tools/check_abi_codes.py 가 헤더·코어·바인딩 간 불일치를 검사한다.
    """

    VALID = 0
    INVALID_FORMAT = 1
    UNSUPPORTED_SCHEMA = 2
    UNSUPPORTED_ALGORITHM = 3
    INVALID_SIGNATURE = 4
    INVALID_METADATA = 5
    EXPIRED = 6
    NOT_YET_VALID = 7
    SERVER_REQUIRED = 8
    SERVER_REJECTED = 9
    REVOKED = 10
    BLACKLISTED = 11
    CHAIN_INVALID = 12
    CHAIN_TOO_DEEP = 13
    POLICY_REJECTED = 14

    _NAMES = {
        VALID: "VALID",
        INVALID_FORMAT: "INVALID_FORMAT",
        UNSUPPORTED_SCHEMA: "UNSUPPORTED_SCHEMA",
        UNSUPPORTED_ALGORITHM: "UNSUPPORTED_ALGORITHM",
        INVALID_SIGNATURE: "INVALID_SIGNATURE",
        INVALID_METADATA: "INVALID_METADATA",
        EXPIRED: "EXPIRED",
        NOT_YET_VALID: "NOT_YET_VALID",
        SERVER_REQUIRED: "SERVER_REQUIRED",
        SERVER_REJECTED: "SERVER_REJECTED",
        REVOKED: "REVOKED",
        BLACKLISTED: "BLACKLISTED",
        CHAIN_INVALID: "CHAIN_INVALID",
        CHAIN_TOO_DEEP: "CHAIN_TOO_DEEP",
        POLICY_REJECTED: "POLICY_REJECTED",
    }

    @classmethod
    def name(cls, code: int) -> str:
        return cls._NAMES.get(code, "UNKNOWN")


class VerifyResult:
    """검증 결과.

    status: 0=요청 처리 성공, -1=인자 오류, -2=입력 파싱/복호화 오류,
            -3=서명/애플리케이션 불일치 (함수별 상세는 C 헤더 참고)
    code:   enum lh_verification_code
    """

    def __init__(self, status: int, code: int) -> None:
        self.status = status
        self.code = code

    @property
    def valid(self) -> bool:
        return self.status == 0 and self.code == VerificationCode.VALID

    def __repr__(self) -> str:
        return (
            f"VerifyResult(status={self.status}, "
            f"code={self.code}, name={VerificationCode.name(self.code)})"
        )


def _platform_dir() -> str:
    system = platform.system()
    plat = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(system)
    if plat is None:
        raise RuntimeError(f"unsupported OS: {system}")
    arch = platform.machine().lower()
    arch = {
        "amd64": "x86_64",
        "x64": "x86_64",
        "x86_64": "x86_64",
        "aarch64": "arm64",
        "arm64": "arm64",
    }.get(arch, arch)
    return f"{plat}-{arch}"


def _lib_name(plat: str) -> str:
    return {
        "macos": "liblicensehub_core.dylib",
        "linux": "liblicensehub_core.so",
        "windows": "licensehub_core.dll",
    }[plat.split("-", 1)[0]]


def _default_lib_path() -> pathlib.Path:
    here = pathlib.Path(__file__).resolve().parent
    plat = _platform_dir()
    return here / "native" / plat / _lib_name(plat)


def _as_bytes(value: object) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, str):
        return value.encode("utf-8")
    raise TypeError(f"expected bytes/bytearray/str, got {type(value).__name__}")


class LicenseGuard:
    """배포형 검증 모듈(LicenseGuard)의 Python 인터페이스."""

    def __init__(self, lib_path: str | pathlib.Path | None = None) -> None:
        override = lib_path or os.environ.get("LICENSEHUB_CORE_LIB")
        path = pathlib.Path(override) if override else _default_lib_path()
        if not path.exists():
            raise FileNotFoundError(f"native library not found: {path}")
        self._lib = ctypes.CDLL(str(path))
        self._bind()

    def _bind(self) -> None:
        c = ctypes

        def fn(name: str, argtypes):
            f = getattr(self._lib, name)
            f.argtypes = argtypes
            f.restype = c.c_int32
            return f

        ptr = c.c_char_p
        size = c.c_size_t
        code_ptr = c.POINTER(c.c_uint32)

        self._verify = fn(
            "lh_verify_certificate",
            [ptr, size, ptr, size, ptr, size, code_ptr],
        )
        self._decrypt = fn(
            "lh_decrypt_verify_trusted_license",
            [ptr, size, ptr, size, ptr, size, code_ptr],
        )
        self._decrypt_low = fn(
            "lh_decrypt_license",
            [ptr, size, ptr, size, ptr, size, code_ptr],
        )
        self._decrypt_online = fn(
            "lh_decrypt_verify_trusted_license_online",
            [ptr, size, ptr, size, ptr, size, code_ptr],
        )
        self._app_id = fn("lh_application_id", [ptr, size, ptr, size])

    def verify_certificate(
        self, certificate, public_key, context=b"{}"
    ) -> VerifyResult:
        """인증서 JSON + Ed25519 공개키 32바이트 + Context JSON."""
        cert = _as_bytes(certificate)
        key = _as_bytes(public_key)
        ctx = _as_bytes(context)
        code = ctypes.c_uint32(0xFFFFFFFF)
        status = self._verify(
            cert, len(cert), key, len(key), ctx, len(ctx), ctypes.byref(code)
        )
        return VerifyResult(status, code.value)

    def decrypt_license(self, envelope, app_private_key, lh_public_key) -> VerifyResult:
        """저수준: 호출자가 제공한 LH 공개키로 엔벨로프를 복호화·검증한다(테스트/도구용)."""
        env = _as_bytes(envelope)
        pri = _as_bytes(app_private_key)
        lh_pub = _as_bytes(lh_public_key)
        if len(pri) != 32:
            raise ValueError(f"app_private_key must be 32 raw bytes, got {len(pri)}")
        code = ctypes.c_uint32(0xFFFFFFFF)
        status = self._decrypt_low(
            env, len(env), pri, len(pri), lh_pub, len(lh_pub), ctypes.byref(code)
        )
        return VerifyResult(status, code.value)

    def decrypt_verify_trusted_license(
        self, envelope, app_private_key, context=b"{}"
    ) -> VerifyResult:
        """암호화 라이선스 + App 개인키 raw 32바이트 + Context JSON (L1)."""
        env = _as_bytes(envelope)
        pri = _as_bytes(app_private_key)
        if len(pri) != 32:
            raise ValueError(f"app_private_key must be 32 raw bytes, got {len(pri)}")
        ctx = _as_bytes(context)
        code = ctypes.c_uint32(0xFFFFFFFF)
        status = self._decrypt(
            env, len(env), pri, len(pri), ctx, len(ctx), ctypes.byref(code)
        )
        return VerifyResult(status, code.value)

    def decrypt_verify_trusted_license_online(
        self, envelope, app_private_key, context=b"{}"
    ) -> VerifyResult:
        """L2: 복호화·서명 검증 후 인증서의 verification_url 로 상태를 확인한다."""
        env = _as_bytes(envelope)
        pri = _as_bytes(app_private_key)
        if len(pri) != 32:
            raise ValueError(f"app_private_key must be 32 raw bytes, got {len(pri)}")
        ctx = _as_bytes(context)
        code = ctypes.c_uint32(0xFFFFFFFF)
        status = self._decrypt_online(
            env, len(env), pri, len(pri), ctx, len(ctx), ctypes.byref(code)
        )
        return VerifyResult(status, code.value)

    def application_id(self, public_key) -> str:
        """응용 공개키(raw 32바이트)에서 애플리케이션 식별자를 계산한다."""
        key = _as_bytes(public_key)
        if len(key) != 32:
            raise ValueError(f"public_key must be 32 raw bytes, got {len(key)}")
        out = ctypes.create_string_buffer(64)
        status = self._app_id(key, len(key), out, ctypes.sizeof(out))
        if status != 0:
            raise RuntimeError(f"lh_application_id failed: {status}")
        return out.value.decode("ascii")
