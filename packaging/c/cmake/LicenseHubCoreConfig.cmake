# LicenseHub Core(검증 모듈) CMake 패키지 설정.
#
# 사용법:
#   cmake -S . -B build -DCMAKE_PREFIX_PATH=/path/to/sdk/c
#   target_link_libraries(app PRIVATE LicenseHubCore::LicenseHubCore)
#
# 타깃:
#   LicenseHubCore::LicenseHubCore         공유 라이브러리
#   LicenseHubCore::LicenseHubCoreStatic   정적 라이브러리 (우회 접점 제거용)

cmake_minimum_required(VERSION 3.16)

get_filename_component(_lh_cmake_dir "${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
# <sdk>/share/cmake/LicenseHubCore -> <sdk>
get_filename_component(_lh_sdk_root "${_lh_cmake_dir}/../../.." ABSOLUTE)

if(APPLE)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)$")
        set(_lh_platform "macos-arm64")
    else()
        set(_lh_platform "macos-x86_64")
    endif()
elseif(UNIX)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
        set(_lh_platform "linux-arm64")
    else()
        set(_lh_platform "linux-x86_64")
    endif()
elseif(WIN32)
    set(_lh_platform "windows-x86_64")
else()
    set(_lh_platform "unsupported")
endif()

if(_lh_platform STREQUAL "unsupported")
    set(LicenseHubCore_FOUND FALSE)
    set(
        LicenseHubCore_NOT_FOUND_MESSAGE
        "지원하지 않는 플랫폼입니다: ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}"
    )
    return()
endif()

set(_lh_libdir "${_lh_sdk_root}/lib/${_lh_platform}")
set(_lh_includedir "${_lh_sdk_root}/include")

if(APPLE)
    set(_lh_shared "${_lh_libdir}/shared/liblicensehub_core.dylib")
    set(_lh_static "${_lh_libdir}/static/liblicensehub_core.a")
    set(_lh_static_private "-framework Security;-framework CoreFoundation;-liconv")
elseif(UNIX)
    set(_lh_shared "${_lh_libdir}/shared/liblicensehub_core.so")
    set(_lh_static "${_lh_libdir}/static/liblicensehub_core.a")
    set(_lh_static_private "pthread;dl;m")
else()
    set(_lh_shared "${_lh_libdir}/shared/licensehub_core.dll")
    set(_lh_static "${_lh_libdir}/static/licensehub_core_static.lib")
    set(_lh_static_private "")
endif()

foreach(_kind shared static)
    if(_kind STREQUAL "shared")
        set(_lh_path "${_lh_shared}")
        set(_lh_type SHARED)
    else()
        set(_lh_path "${_lh_static}")
        set(_lh_type STATIC)
    endif()

    if(NOT EXISTS "${_lh_path}")
        set(LicenseHubCore_FOUND FALSE)
        set(LicenseHubCore_NOT_FOUND_MESSAGE "라이브러리를 찾을 수 없습니다: ${_lh_path}")
        return()
    endif()

    if(_kind STREQUAL "static")
        add_library(LicenseHubCore::LicenseHubCoreStatic ${_lh_type} IMPORTED)
        set_target_properties(
            LicenseHubCore::LicenseHubCoreStatic
            PROPERTIES IMPORTED_LOCATION "${_lh_path}"
                       INTERFACE_INCLUDE_DIRECTORIES "${_lh_includedir}"
        )
        if(_lh_static_private)
            set_property(
                TARGET LicenseHubCore::LicenseHubCoreStatic
                APPEND PROPERTY INTERFACE_LINK_LIBRARIES ${_lh_static_private}
            )
        endif()
    else()
        add_library(LicenseHubCore::LicenseHubCore ${_lh_type} IMPORTED)
        set_target_properties(
            LicenseHubCore::LicenseHubCore
            PROPERTIES IMPORTED_LOCATION "${_lh_path}"
                       INTERFACE_INCLUDE_DIRECTORIES "${_lh_includedir}"
        )
    endif()
endforeach()

set(LicenseHubCore_VERSION "0.1.0")
set(LicenseHubCore_PLATFORM "${_lh_platform}")
set(LicenseHubCore_FOUND TRUE)
