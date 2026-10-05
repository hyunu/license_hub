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

/* Low-level/tooling API: decrypts an EncryptedLicense envelope with Z_Pri and
 * a caller-supplied LH_Pub. Do not use as the Application X entry point; the
 * production path below enforces embedded LK2. Returns 0 when processed
 * (result_code=0 on success), -1 for
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

/* Production application path: decrypts the envelope with Z_Pri and validates
 * its LicenseHub signature and payload using the embedded LK2 (LH_Pub). The
 * caller cannot supply/replace the trust anchor. result_code uses
 * enum lh_verification_code; returns -1 for arguments, -2 for malformed or
 * undecryptable envelopes, -3 for envelope-signature/application mismatch. */
int32_t lh_decrypt_verify_trusted_license(
    const uint8_t *envelope,
    size_t envelope_len,
    const uint8_t *z_private_key,
    size_t z_private_key_len,
    const uint8_t *context,
    size_t context_len,
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
