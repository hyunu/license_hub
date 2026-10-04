'use strict';

const fs = require('fs');
const path = require('path');
const { LicenseGuard, VerificationCode } = require('./licenseguard');

const base = path.resolve(__dirname, '..', 'testdata');
const publicKey = fs.readFileSync(path.join(base, 'public_key.bin'));

const checks = [
    ['l1.json', 'context_l1.json', VerificationCode.VALID],
    ['l2.json', 'context_l2.json', VerificationCode.VALID],
    ['l3.json', 'context_l3.json', VerificationCode.VALID],
    ['l1_tampered.json', 'context_l1.json', VerificationCode.INVALID_SIGNATURE],
];

const guard = new LicenseGuard();
let fails = 0;

console.log(`LicenseGuard Node.js self-test (fixtures: ${base})`);
for (const [certName, ctxName, expected] of checks) {
    const result = guard.verify(
        fs.readFileSync(path.join(base, certName)),
        publicKey,
        fs.readFileSync(path.join(base, ctxName))
    );
    const pass = result.status === 0 && result.code === expected;
    console.log(
        `  ${certName.padEnd(18)} status=${result.status} code=${result.code} ` +
        `(${VerificationCode.name(result.code)})  ${pass ? 'PASS' : 'FAIL'}`
    );
    if (!pass) fails++;
}

// LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화.
{
    const env = guard.decryptLicense(
        fs.readFileSync(path.join(base, 'envelope.json')),
        fs.readFileSync(path.join(base, 'z_private_key.bin')),
        publicKey
    );
    const pass = env.status === 0 && env.code === VerificationCode.VALID;
    console.log(`  ${'envelope.json'.padEnd(18)} status=${env.status} code=${env.code}  ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) fails++;
}

// LH-REQ-012: Challenge-Response 검증.
{
    const status = guard.verifyChallenge(
        fs.readFileSync(path.join(base, 'z_public_key.bin')),
        fs.readFileSync(path.join(base, 'challenge.json')),
        fs.readFileSync(path.join(base, 'challenge_signature.b64'))
    );
    const pass = status === 0;
    console.log(`  ${'challenge'.padEnd(18)} status=${status}  ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) fails++;
}

// LH-REQ-013: Application ID 파생.
{
    const appId = guard.applicationId(fs.readFileSync(path.join(base, 'z_public_key.bin')));
    const pass = appId.length === 43;
    console.log(`  ${'application_id'.padEnd(18)} ${appId}  ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) fails++;
}

if (fails) {
    console.log(`FAIL (${fails})`);
    process.exit(1);
}
console.log('ALL PASS');