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
