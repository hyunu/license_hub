/*
 * LicenseGuard C 검증 예제 / 자가 테스트.
 *
 * core/include/licensehub_core.h 가 정의하는 lh_verify_certificate 를
 * 사용해 공용 픽스처(bindings/testdata)의 인증서를 검증한다.
 *
 * 사용: verify_all <testdata 경로>
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "licensehub_core.h"

static uint8_t *read_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "cannot open: %s\n", path);
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

static int verify_pair(const char *base, const char *cert_name,
                       const char *ctx_name, uint32_t expected_code) {
    char cert_path[512];
    char key_path[512];
    char ctx_path[512];
    snprintf(cert_path, sizeof(cert_path), "%s/%s", base, cert_name);
    snprintf(key_path, sizeof(key_path), "%s/public_key.bin", base);
    snprintf(ctx_path, sizeof(ctx_path), "%s/%s", base, ctx_name);

    size_t cert_len = 0, key_len = 0, ctx_len = 0;
    uint8_t *cert = read_file(cert_path, &cert_len);
    uint8_t *key = read_file(key_path, &key_len);
    uint8_t *ctx = read_file(ctx_path, &ctx_len);
    if (!cert || !key || !ctx) {
        free(cert);
        free(key);
        free(ctx);
        return -1;
    }

    uint32_t code = UINT32_MAX;
    int32_t status = lh_verify_certificate(cert, cert_len, key, key_len, ctx, ctx_len, &code);

    free(cert);
    free(key);
    free(ctx);

    int pass = (status == 0 && code == expected_code);
    printf("  %-18s status=%d code=%u  %s\n", cert_name, status, code,
           pass ? "PASS" : "FAIL");
    return pass ? 0 : -1;
}

int main(int argc, char **argv) {
    const char *base = (argc > 1) ? argv[1] : "../testdata";
    int fails = 0;

    printf("LicenseGuard C self-test (fixtures: %s)\n", base);
    fails += verify_pair(base, "l1.json", "context_l1.json", LH_VALID);
    fails += verify_pair(base, "l2.json", "context_l2.json", LH_VALID);
    fails += verify_pair(base, "l3.json", "context_l3.json", LH_VALID);
    fails += verify_pair(base, "l1_tampered.json", "context_l1.json", LH_INVALID_SIGNATURE);

    if (fails != 0) {
        printf("FAIL (%d)\n", fails);
        return 1;
    }
    printf("ALL PASS\n");
    return 0;
}