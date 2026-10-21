/* LicenseGuard C 운영 경로 예제.
 *
 * 암호화 라이선스(license.lic.json)를 App 개인키(raw 32바이트)로 복호화하고,
 * 내장 LK2 로 서명·자격을 검증한다. 실패하면 핵심 로직을 켜지 않는다.
 *
 * 사용: decrypt_verify_example <license.json> <app_private_key.bin> <context.json>
 *
 * 권장 빌드 — **정적 링크**. 검증 코드가 응용 바이너리 안으로 들어가므로
 * LD_PRELOAD / DYLD_INSERT_LIBRARIES / 라이브러리 파일 교체로 검증 함수를
 * 가로챌 수 없다.
 *
 *   export PKG_CONFIG_PATH=<sdk>/c/lib/<platform>/pkgconfig
 *   cc decrypt_verify_example.c \
 *      $(pkg-config --cflags --libs --static licensehub_core_static) -o app
 *
 *   # CMake: target_link_libraries(app PRIVATE LicenseHubCore::LicenseHubCoreStatic)
 *
 * 빌드 후 확인 (아무것도 나오면 안 된다):
 *   ldd app      | grep licensehub     # Linux
 *   otool -L app | grep licensehub     # macOS
 *
 * 공유 링크: -L <sdk>/c/lib/<platform>/shared -llicensehub_core
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "licensehub_core.h"

static uint8_t *read_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        return NULL;
    }
    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return NULL;
    }
    long size = ftell(fp);
    if (size < 0 || fseek(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        return NULL;
    }
    uint8_t *buf = (uint8_t *)malloc((size_t)size);
    if (!buf) {
        fclose(fp);
        return NULL;
    }
    if (fread(buf, 1, (size_t)size, fp) != (size_t)size) {
        free(buf);
        fclose(fp);
        return NULL;
    }
    fclose(fp);
    *out_len = (size_t)size;
    return buf;
}

int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr, "usage: %s <license.json> <app_private_key.bin> <context.json>\n", argv[0]);
        return 2;
    }

    size_t lic_len = 0, pri_len = 0, ctx_len = 0;
    uint8_t *lic = read_file(argv[1], &lic_len);
    uint8_t *pri = read_file(argv[2], &pri_len);
    uint8_t *ctx = read_file(argv[3], &ctx_len);
    if (!lic || !pri || !ctx) {
        fprintf(stderr, "failed to read input files\n");
        free(lic);
        free(pri);
        free(ctx);
        return 2;
    }
    if (pri_len != 32) {
        fprintf(stderr, "app private key must be 32 raw bytes (got %zu)\n", pri_len);
        free(lic);
        free(pri);
        free(ctx);
        return 2;
    }

    uint32_t code = UINT32_MAX;
    int32_t status = lh_decrypt_verify_trusted_license(
        lic, lic_len, pri, pri_len, ctx, ctx_len, &code);

    printf("status=%d code=%u\n", status, code);
    if (status == 0 && code == LH_VALID) {
        printf("VALID - activate core logic\n");
    } else {
        printf("NOT VALID - keep core logic disabled (fail-closed)\n");
    }

    free(lic);
    free(pri);
    free(ctx);
    return (status == 0 && code == LH_VALID) ? 0 : 1;
}
