"""setuptools 진입점.

`bdist_wheel --plat-name` 으로 wheel 플랫폼 태그를 명시해야 하므로 legacy
경로를 쓴다. setuptools 61 미만은 pyproject.toml 의 [project] 를 읽지 못해
이름이 UNKNOWN 이 되므로, 메타데이터를 여기서도 명시한다.

단일 출처는 licensehub_licenseguard.__version__ 이다.
"""

from pathlib import Path
import sys

from setuptools import setup

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from licensehub_licenseguard import __version__  # noqa: E402

setup(
    name="licensehub-licenseguard",
    version=__version__,
    description="LicenseHub LicenseGuard verification binding",
    license="MIT",
    python_requires=">=3.9",
    packages=["licensehub_licenseguard"],
    package_data={"licensehub_licenseguard": ["native/*/*"]},
    include_package_data=True,
    zip_safe=False,
)
