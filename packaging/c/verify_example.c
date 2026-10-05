/* LicenseGuard C 사용 예제.
 *
 * lh_verify_certificate 를 호출해 인증서를 검증한다.
 * 사용: verify_example <cert.json> <public_key.bin> <context.json>
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
    fseek(fp, 0, SEEK_END);
    long size = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    uint8_t *buf = (uint8_t *)malloc((size_t)size);
    if (buf && fread(buf, 1, (size_t)size, fp) != (size_t)size) {
        free(buf);
        buf = NULL;
    }
    fclose(fp);
    *out_len = buf ? (size_t)size : 0;
    return buf;
}

int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr, "usage: %s <cert.json> <public_key.bin> <context.json>\n", argv[0]);
        return 2;
    }

    size_t cert_len = 0, key_len = 0, ctx_len = 0;
    uint8_t *cert = read_file(argv[1], &cert_len);
    uint8_t *key = read_file(argv[2], &key_len);
    uint8_t *ctx = read_file(argv[3], &ctx_len);
    if (!cert || !key || !ctx) {
        fprintf(stderr, "failed to read input files\n");
        free(cert);
        free(key);
        free(ctx);
        return 2;
    }

    uint32_t code = UINT32_MAX;
    int32_t status = lh_verify_certificate(cert, cert_len, key, key_len, ctx, ctx_len, &code);
    printf("status=%d code=%u\n", status, code);
    printf(status == 0 && code == LH_VALID ? "VALID - activate\n" : "NOT VALID\n");

    free(cert);
    free(key);
    free(ctx);
    return (status == 0 && code == LH_VALID) ? 0 : 1;
}