#ifndef LICENSEHUB_CORE_H
#define LICENSEHUB_CORE_H

#include <stddef.h>
#include <stdint.h>

/* Returns 0 when verification was processed, -1 for invalid arguments, or
 * -2 for malformed input. The verification result is written to result_code. */
#ifdef __cplusplus
extern "C" {
#endif

int32_t lh_verify_certificate(
    const uint8_t *certificate,
    size_t certificate_len,
    const uint8_t *public_key,
    size_t public_key_len,
    const uint8_t *context,
    size_t context_len,
    uint32_t *result_code
);

/* Copies the embedded trusted public key (K1, reassembled at runtime) into
 * out. Returns 0 on success, -1 for invalid arguments (including a buffer
 * smaller than 32 bytes), or -2 if the scattered key integrity check fails.
 * On success out_len is set to 32. */
int32_t lh_trusted_public_key(uint8_t *out, size_t *out_len);

/* Verifies a certificate using the embedded trusted public key (K1), for the
 * X case (application core-logic protection). Same return convention as
 * lh_verify_certificate but no public_key argument. */
int32_t lh_verify_trusted_certificate(
    const uint8_t *certificate,
    size_t certificate_len,
    const uint8_t *context,
    size_t context_len,
    uint32_t *result_code
);

/* Decrypts an EncryptedLicense envelope with the application private key
 * (Z_Pri). Returns 0 when processed (result_code=0 on success), -1 for
 * invalid arguments, -2 for parse/decrypt failures, or -3 for envelope
 * signature/application mismatch. The envelope is validated with LH_Pub and
 * bound to the application key pair (LH-REQ-008, LH-REQ-012). */
int32_t lh_decrypt_license(
    const uint8_t *envelope,
    size_t envelope_len,
    const uint8_t *z_private_key,
    size_t z_private_key_len,
    const uint8_t *lh_public_key,
    size_t lh_public_key_len,
    uint32_t *result_code
);

/* Verifies an application challenge-response signature (LH-REQ-012).
 * Returns 0 on success, -1 for invalid arguments, -2 for parse failures,
 * or 1 when the signature does not match Z_Pub. */
int32_t lh_verify_challenge(
    const uint8_t *z_public_key,
    size_t z_public_key_len,
    const uint8_t *challenge,
    size_t challenge_len,
    const uint8_t *signature_b64,
    size_t signature_b64_len
);

/* Derives the application ID (SHA-256 of Z_Pub, LH-REQ-013) into out.
 * Returns 0 on success, -1 for invalid arguments. out must hold at least
 * 64 bytes; the result is NUL-terminated URL-safe Base64. */
int32_t lh_application_id(
    const uint8_t *z_public_key,
    size_t z_public_key_len,
    uint8_t *out,
    size_t out_len
);

#ifdef __cplusplus
}
#endif

enum lh_verification_code {
    LH_VALID = 0,
    LH_INVALID_FORMAT = 1,
    LH_UNSUPPORTED_SCHEMA = 2,
    LH_UNSUPPORTED_ALGORITHM = 3,
    LH_INVALID_SIGNATURE = 4,
    LH_INVALID_METADATA = 5,
    LH_EXPIRED = 6,
    LH_NOT_YET_VALID = 7,
    LH_SERVER_REQUIRED = 8,
    LH_SERVER_REJECTED = 9,
    LH_REVOKED = 10,
    LH_BLACKLISTED = 11,
    LH_DEVICE_MISMATCH = 12,
    LH_CHAIN_INVALID = 13,
    LH_CHAIN_TOO_DEEP = 14,
    LH_POLICY_REJECTED = 15
};

#endif
