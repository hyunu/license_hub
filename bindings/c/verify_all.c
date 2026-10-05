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

static uint8_t *read_file_buf(const char *base, const char *name, size_t *out_len) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", base, name);
    return read_file(path, out_len);
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

    /* LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화·검증 */
    {
        size_t env_len = 0, zkey_len = 0, lhkey_len = 0;
        uint8_t *env = read_file_buf(base, "envelope.json", &env_len);
        uint8_t *zkey = read_file_buf(base, "z_private_key.bin", &zkey_len);
        uint8_t *lhkey = read_file_buf(base, "public_key.bin", &lhkey_len);
        if (!env || !zkey || !lhkey) {
            free(env);
            free(zkey);
            free(lhkey);
            fails++;
        } else {
            uint32_t code = UINT32_MAX;
            int32_t status = lh_decrypt_license(env, env_len, zkey, zkey_len,
                                                lhkey, lhkey_len, &code);
            int pass = (status == 0 && code == LH_VALID);
            printf("  %-18s status=%d code=%u  %s\n", "envelope.json",
                   status, code, pass ? "PASS" : "FAIL");
            if (!pass) {
                fails++;
            }
        }
        free(env);
        free(zkey);
        free(lhkey);
    }

    /* X의 제품 경로는 내장 LK2만 신뢰한다. 외부 test issuer 서명은 거부해야 한다. */
    {
        size_t env_len = 0, zkey_len = 0, ctx_len = 0;
        uint8_t *env = read_file_buf(base, "envelope.json", &env_len);
        uint8_t *zkey = read_file_buf(base, "z_private_key.bin", &zkey_len);
        uint8_t *ctx = read_file_buf(base, "context_l1.json", &ctx_len);
        if (!env || !zkey || !ctx) {
            free(env);
            free(zkey);
            free(ctx);
            fails++;
        } else {
            uint32_t code = UINT32_MAX;
            int32_t status = lh_decrypt_verify_trusted_license(
                env, env_len, zkey, zkey_len, ctx, ctx_len, &code);
            int pass = (status == -3);
            printf("  %-18s status=%d  %s\n", "embedded_lk2",
                   status, pass ? "PASS (untrusted fixture rejected)" : "FAIL");
            if (!pass) fails++;
        }
        free(env);
        free(zkey);
        free(ctx);
    }

    /* LH-REQ-012: Challenge-Response 검증 */
    {
        size_t zpub_len = 0, chal_len = 0, sig_len = 0;
        uint8_t *zpub = read_file_buf(base, "z_public_key.bin", &zpub_len);
        uint8_t *chal = read_file_buf(base, "challenge.json", &chal_len);
        uint8_t *sig = read_file_buf(base, "challenge_signature.b64", &sig_len);
        if (!zpub || !chal || !sig) {
            free(zpub);
            free(chal);
            free(sig);
            fails++;
        } else {
            int32_t status = lh_verify_challenge(zpub, zpub_len, chal, chal_len, sig, sig_len);
            int pass = (status == 0);
            printf("  %-18s status=%d  %s\n", "challenge", status,
                   pass ? "PASS" : "FAIL");
            if (!pass) {
                fails++;
            }
        }
        free(zpub);
        free(chal);
        free(sig);
    }

    /* LH-REQ-013: Application ID 파생 */
    {
        size_t zpub_len = 0;
        uint8_t *zpub = read_file_buf(base, "z_public_key.bin", &zpub_len);
        if (!zpub) {
            fails++;
        } else {
            uint8_t out[64] = {0};
            int32_t status = lh_application_id(zpub, zpub_len, out, sizeof(out));
            int pass = (status == 0 && strlen((char *)out) == 43);
            printf("  %-18s status=%d id=%.*s  %s\n", "application_id",
                   status, (int)strlen((char *)out), out, pass ? "PASS" : "FAIL");
            if (!pass) {
                fails++;
            }
        }
        free(zpub);
    }

    if (fails != 0) {
        printf("FAIL (%d)\n", fails);
        return 1;
    }
    printf("ALL PASS\n");
    return 0;
}
