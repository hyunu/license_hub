"""LicenseGuard Python 바인딩.

core 의 C ABI(lh_verify_certificate)를 ctypes 로 호출한다. 검증만 수행하며
발급·개인키 기능은 포함하지 않는다.
"""

from __future__ import annotations

import ctypes
import pathlib
import platform


class VerificationCode:
    """lh_verify_certificate 의 검증 결과 코드.

    core/include/licensehub_core.h 의 enum과 동일한 값을 유지해야 한다.
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
    DEVICE_MISMATCH = 12
    CHAIN_INVALID = 13
    CHAIN_TOO_DEEP = 14
    POLICY_REJECTED = 15

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
        DEVICE_MISMATCH: "DEVICE_MISMATCH",
        CHAIN_INVALID: "CHAIN_INVALID",
        CHAIN_TOO_DEEP: "CHAIN_TOO_DEEP",
        POLICY_REJECTED: "POLICY_REJECTED",
    }

    @classmethod
    def name(cls, code: int) -> str:
        return cls._NAMES.get(code, "UNKNOWN")


class VerifyResult:
    """lh_verify_certificate 의 결과.

    status: 0=요청 처리 성공, -1=인자 오류, -2=입력 파싱 오류.
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


def _default_lib_path() -> pathlib.Path:
    """빌드 스크립트가 만든 core/dist/<os>-<arch>/lib 를 찾는다."""
    repo_root = pathlib.Path(__file__).resolve().parent.parent.parent
    plat = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}[platform.system()]
    arch = platform.machine().lower()
    lib_name = {
        "macos": "liblicensehub_core.dylib",
        "linux": "liblicensehub_core.so",
        "windows": "licensehub_core.dll",
    }[plat]
    return repo_root / "core" / "dist" / f"{plat}-{arch}" / "lib" / lib_name


class LicenseGuard:
    """배포형 검증 모듈의 Python 인터페이스."""

    def __init__(self, lib_path: str | pathlib.Path | None = None) -> None:
        path = pathlib.Path(lib_path) if lib_path else _default_lib_path()
        if not path.exists():
            raise FileNotFoundError(f"native library not found: {path}")
        self._lib = ctypes.CDLL(str(path))

        fn = self._lib.lh_verify_certificate
        fn.argtypes = [
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_uint32),
        ]
        fn.restype = ctypes.c_int32
        self._fn = fn

    def verify(self, certificate: bytes, public_key: bytes, context: bytes = b"{}") -> VerifyResult:
        """인증서 JSON 바이트, Ed25519 공개키 32바이트, 검증 Context JSON 바이트."""
        cert_buf = ctypes.create_string_buffer(certificate)
        key_buf = ctypes.create_string_buffer(public_key)
        ctx_buf = ctypes.create_string_buffer(context)
        code = ctypes.c_uint32(0xFFFFFFFF)
        status = self._fn(
            cert_buf, len(certificate),
            key_buf, len(public_key),
            ctx_buf, len(context),
            ctypes.byref(code),
        )
        return VerifyResult(status, code.value)